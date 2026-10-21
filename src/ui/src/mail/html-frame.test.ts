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

	it('shows a body in one part as before', async () => {
		const html =
			'<style>p{color:red}</style><p>Hi<!-- note --><img src="https://t.example/a.png"></p>';
		const { doc, blocked } = await show(html);
		const content = sanitizeEmailHtml(html, { allowRemote: false, cidUrls: new Map() });
		expect(doc.body.innerHTML).toBe(content.body);
		expect(doc.querySelectorAll('style')[1]!.textContent).toBe(content.css);
		expect(blocked).toEqual([content.blocked]);
	});
});
