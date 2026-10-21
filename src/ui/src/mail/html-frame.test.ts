// @vitest-environment jsdom
import { defineMailHtmlFrame, type MailHtmlFrame } from './html-frame';
import { sanitizeEmailHtml } from './sanitize';

beforeAll(() => defineMailHtmlFrame());
afterEach(() => document.body.replaceChildren());

/** A frame showing `html`, sent in `htmlParts` when given: its document, and the counts it sent. */
async function show(html: string, htmlParts: readonly string[] | null = null) {
	const frame = document.createElement('mail-html-frame') as MailHtmlFrame;
	const blocked: number[] = [];
	frame.addEventListener('mail-remote-blocked', (event) =>
		blocked.push((event as CustomEvent<{ count: number }>).detail.count),
	);
	frame.html = html;
	frame.htmlParts = htmlParts;
	document.body.append(frame);
	await frame.updateComplete;
	const srcdoc = frame.shadowRoot!.querySelector('iframe')!.srcdoc;
	return { doc: new DOMParser().parseFromString(srcdoc, 'text/html'), blocked };
}

/**
 * A frame once its document has loaded: the element, its iframe and that document, which jsdom
 * leaves empty (it does not load `srcdoc`). The load is caught on its way to the iframe, so
 * `prepare` sees the document before the frame's own load handler does.
 */
async function loaded(prepare: (doc: Document, frame: HTMLIFrameElement) => void = () => {}) {
	const element = document.createElement('mail-html-frame') as MailHtmlFrame;
	document.body.append(element);
	const frame = await new Promise<HTMLIFrameElement>((resolve) =>
		element.shadowRoot!.addEventListener(
			'load',
			(event) => {
				const target = event.target as HTMLIFrameElement;
				prepare(target.contentDocument!, target);
				resolve(target);
			},
			{ capture: true, once: true },
		),
	);
	return { element, frame, doc: frame.contentDocument! };
}

describe('<mail-html-frame>', () => {
	it('shows each part of a body sent in several on its own', async () => {
		// Read as one text, the comment the first part leaves open would take in the others.
		const htmlParts = ['<p>Hello<!--', '<div>Footer</div>', '<p>Bye</p>'];
		const { doc } = await show(htmlParts.join(''), htmlParts);
		expect(doc.body.textContent).toBe('HelloFooterBye');
	});

	it('counts what every part blocked', async () => {
		const htmlParts = [
			'<img src="https://t.example/a.png"><!--',
			'<img src="https://t.example/b.png">',
		];
		const { blocked } = await show(htmlParts.join(''), htmlParts);
		expect(blocked).toEqual([2]);
	});

	it('writes each style sheet of a message in a style element of its own', async () => {
		// Read as one sheet, a selector left without its block would take in the next sheet's rule.
		const sheets = (doc: Document) =>
			[...doc.querySelectorAll('style')].slice(1).map((style) => style.textContent);
		const html = '<style>p</style><style>b{color:blue}</style>';
		expect(sheets((await show(html)).doc)).toEqual(['p', 'b{color:blue}']);
		const htmlParts = ['<style>p</style><p>a</p>', '<style>b{color:blue}</style><b>b</b>'];
		expect(sheets((await show(htmlParts.join(''), htmlParts)).doc)).toEqual(['p', 'b{color:blue}']);
	});

	it('shows a body in one part as before', async () => {
		const html =
			'<style>p{color:red}</style><p>Hi<!-- note --><img src="https://t.example/a.png"></p>';
		const { doc, blocked } = await show(html);
		const content = sanitizeEmailHtml(html, { allowRemote: false, cidUrls: new Map() });
		expect(doc.body.innerHTML).toBe(content.body);
		expect([...doc.querySelectorAll('style')].slice(1).map((style) => style.textContent)).toEqual(
			content.sheets,
		);
		expect(blocked).toEqual([content.blocked]);
	});

	it('shows a message on the styling of its own body, and counts its remote picture', async () => {
		const attributes = (doc: Document) =>
			Object.fromEntries([...doc.body.attributes].map(({ name, value }) => [name, value]));
		const { doc, blocked } = await show(
			'<body bgcolor="#000000" text="#ffffff" style="padding:0" background="https://t.example/bg.png" onload="steal()"><p>Light</p></body>',
		);
		expect(attributes(doc)).toEqual({ style: 'padding:0', bgcolor: '#000000', text: '#ffffff' });
		expect(blocked).toEqual([1]);
		// Sent in several parts, the body is styled as the parts read as one document would style it.
		const htmlParts = [
			'<body bgcolor="#000000"><p>a</p>',
			'<body bgcolor="#ffffff" text="#eeeeee"><p>b</p>',
		];
		const parts = await show(htmlParts.join(''), htmlParts);
		expect(attributes(parts.doc)).toEqual({ bgcolor: '#000000', text: '#eeeeee' });
	});

	it('opens compose for a mailto: link or image map area instead of following it', async () => {
		const { element, doc } = await loaded();
		doc.body.innerHTML =
			'<a href="mailto:ada@example.com">Ada</a><img usemap="#m" alt="Map"><map name="m"><area shape="rect" coords="0,0,10,10" href="MAILTO:bob@example.com?subject=Hi"></map>';
		const asked: string[] = [];
		element.addEventListener('mail-mailto', (event) =>
			asked.push((event as CustomEvent<{ href: string }>).detail.href),
		);
		const followed = [...doc.querySelectorAll('a, area')].map((target) => {
			const click = new doc.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true });
			target.dispatchEvent(click);
			return !click.defaultPrevented;
		});
		expect(asked).toEqual(['mailto:ada@example.com', 'MAILTO:bob@example.com?subject=Hi']);
		expect(followed).toEqual([false, false]);
	});

	it('hands a key pressed in its message on, but one the message acts on itself', async () => {
		const { element, doc } = await loaded();
		doc.body.innerHTML = '<p>Hello</p><a href="https://example.com/">a link</a>';
		const heard: [string, boolean, boolean][] = [];
		element.addEventListener('keydown', (event) => {
			heard.push([event.key, event.ctrlKey, event.composed]);
			// A shortcut takes this one.
			if (event.key === 'r') event.preventDefault();
		});
		const press = (key: string, init: KeyboardEventInit = {}): boolean => {
			const event = new doc.defaultView!.KeyboardEvent('keydown', {
				key,
				bubbles: true,
				cancelable: true,
				...init,
			});
			doc.querySelector('p')!.dispatchEvent(event);
			return event.defaultPrevented;
		};
		expect([press('r'), press('e'), press('Escape'), press('Enter', { ctrlKey: true })]).toEqual([
			true,
			false,
			false,
			false,
		]);
		// Scrolling it, moving the focus in it, following its link and selecting its text stay its own.
		for (const key of ['ArrowDown', ' ', 'PageDown', 'End', 'Enter', 'Tab']) press(key);
		press('a', { ctrlKey: true });
		press('A', { metaKey: true, shiftKey: true });
		expect(heard).toEqual([
			['r', false, true],
			['e', false, true],
			['Escape', false, true],
			['Enter', true, true],
		]);
	});

	it('fits the frame again when a web font arrives after its message has loaded', async () => {
		// Both are own properties of the frame's document, which goes with the frame: nothing shared.
		let height = 100;
		const fonts = new EventTarget();
		const { frame } = await loaded((doc) => {
			Object.defineProperty(doc, 'fonts', { configurable: true, value: fonts });
			Object.defineProperty(doc.documentElement, 'scrollHeight', {
				configurable: true,
				get: () => height,
			});
		});
		await vi.waitFor(() => expect(frame.style.height).toBe('100px'));
		// A font the text asks for only now (a style for another width) sets it on more lines.
		height = 140;
		fonts.dispatchEvent(new Event('loadingdone'));
		await vi.waitFor(() => expect(frame.style.height).toBe('140px'));
	});

	it('fits the frame again when a details element of its message opens or closes', async () => {
		// An own property of the frame's document, which goes with the frame: nothing shared.
		let height = 100;
		const { frame, doc } = await loaded((doc) => {
			Object.defineProperty(doc.documentElement, 'scrollHeight', {
				configurable: true,
				get: () => height,
			});
		});
		doc.body.innerHTML = '<details><summary>More</summary><p>What it holds</p></details>';
		await vi.waitFor(() => expect(frame.style.height).toBe('100px'));
		// Opened, it shows what it holds; closed, it hides it again. Its toggle event does not bubble.
		const details = doc.querySelector('details')!;
		height = 160;
		details.open = true;
		await vi.waitFor(() => expect(frame.style.height).toBe('160px'));
		height = 100;
		details.open = false;
		await vi.waitFor(() => expect(frame.style.height).toBe('100px'));
	});

	it('takes no height from the empty document a frame loads before its message', async () => {
		// A browser loads an empty document into a frame as it enters the page, before `srcdoc` is
		// written, and the message's own after it: measured in between, the frame would take the
		// empty one's height for a moment. The load here is that first one: no `srcdoc` yet.
		const { frame } = await loaded((doc, frame) => {
			Object.defineProperty(doc.documentElement, 'scrollHeight', {
				configurable: true,
				get: () => 52,
			});
			Object.defineProperty(frame, 'srcdoc', { configurable: true, get: () => '' });
		});
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		expect(frame.style.height).toBe('');
		delete (frame as { srcdoc?: string }).srcdoc;
	});
});
