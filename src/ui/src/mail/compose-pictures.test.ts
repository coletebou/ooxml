// @vitest-environment jsdom
import {
	composeDraft,
	draftFromMessage,
	ENGLISH_QUOTE_FORMAT,
	type ComposeState,
	type Draft,
	type DraftAttachment,
	type MailAttachment,
	type MailMessage,
} from 'ooxml-core/mail';
import { defineMailCompose, type MailCompose } from './compose';
import { cidUrlsOf } from './compose-pictures';

type Updating = HTMLElement & { updateComplete: Promise<boolean> };
type Download = (part: DraftAttachment) => Promise<Uint8Array | null>;

beforeAll(() => defineMailCompose());
// The windows go first: letting their pictures go revokes the object URLs a test may have stubbed.
afterEach(() => {
	document.body.replaceChildren();
	vi.unstubAllGlobals();
	Reflect.deleteProperty(document, 'execCommand');
});

/** Object URLs (jsdom has none) for the rest of the test, recording what was made and revoked. */
function objectUrls() {
	const made: Blob[] = [];
	const revoked: string[] = [];
	vi.stubGlobal(
		'URL',
		Object.assign(class extends URL {}, {
			createObjectURL: (blob: Blob) => `blob:test/${made.push(blob)}`,
			revokeObjectURL: (url: string) => void revoked.push(url),
		}),
	);
	return { made, revoked };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');

/** A part of a message: inline when it has a `cid`, else a file. */
const part = (blobId: string, name: string, type: string, cid: string | null): MailAttachment => ({
	partId: blobId,
	blobId,
	name,
	type,
	size: 4,
	disposition: cid ? 'inline' : 'attachment',
	cid,
});

/** A message that shows its logo (`logo@example.test`) by `cid:` and carries a file besides. */
function original(logoType = 'image/png'): MailMessage {
	return {
		id: 'm1',
		threadId: 'm1',
		blobId: 'm1-raw',
		mailboxIds: ['inbox'],
		keywords: {},
		receivedAt: Date.UTC(2026, 9, 20),
		size: 100,
		messageId: ['m1@example.test'],
		inReplyTo: [],
		references: [],
		from: [{ name: 'Ada', email: 'ada@example.test' }],
		to: [{ name: 'Sam', email: 'sam@example.test' }],
		cc: [],
		bcc: [],
		replyTo: [],
		subject: 'Our logo',
		preview: 'Our logo is below.',
		hasAttachment: true,
		text: 'Our logo is below.',
		html: '<p>Our logo is below.</p><p><img src="cid:logo@example.test" alt="Logo" width="96"></p>',
		attachments: [
			part('logo-blob', 'logo.png', logoType, 'logo@example.test'),
			part('notes-blob', 'notes.txt', 'text/plain', null),
		],
	};
}

/** The draft a forward of `original()` starts with, as the client makes it. */
const forward = (logoType?: string): Draft =>
	composeDraft('forward', original(logoType), {
		identity: null,
		me: [],
		format: ENGLISH_QUOTE_FORMAT,
	});

const composeState = (draft: Draft, session = 1): ComposeState => ({
	session,
	mode: 'forward',
	draft,
	status: 'editing',
	savedAt: null,
	error: null,
	uploading: 0,
});

/** A download each call of which waits until the test hands its bytes over. */
function slowDownloads() {
	const calls: { part: DraftAttachment; finish: (bytes: Uint8Array | null) => void }[] = [];
	const download: Download = (part) =>
		new Promise((resolve) => calls.push({ part, finish: resolve }));
	return { calls, download };
}

async function settle(el: MailCompose): Promise<void> {
	for (let i = 0; i < 3; i++) {
		await el.updateComplete;
		for (const field of el.shadowRoot!.querySelectorAll<Updating>('mail-recipients'))
			await field.updateComplete;
	}
}

async function mount(draft: Draft, download?: Download): Promise<MailCompose> {
	const el = document.createElement('mail-compose') as MailCompose;
	if (download) el.download = download;
	el.compose = composeState(draft);
	document.body.append(el);
	await settle(el);
	return el;
}

const editor = (el: MailCompose) => el.shadowRoot!.querySelector<HTMLElement>('.editor')!;
const pictures = (el: MailCompose) => [...editor(el).querySelectorAll('img')];
const files = (el: MailCompose) =>
	[...el.shadowRoot!.querySelectorAll('.files li span')].map((name) => name.textContent);

/** The `src` of every picture in `html`, as the draft's HTML has them. */
function sources(html: string): (string | null)[] {
	return attributes(html, 'img', 'src');
}

/** Attribute `name` of each element `selector` finds in `html`. */
function attributes(html: string, selector: string, name: string): (string | null)[] {
	const box = document.createElement('template');
	box.innerHTML = html;
	return [...box.content.querySelectorAll(selector)].map((el) => el.getAttribute(name));
}

/** Edit the editor as a person would (`change` the content, then the input event): the HTML handed back. */
function edit(
	el: MailCompose,
	change: (editor: HTMLElement) => void = (e) => e.append('!'),
): string {
	const box = editor(el);
	// jsdom has no innerText.
	Object.defineProperty(box, 'innerText', { configurable: true, get: () => box.textContent });
	let html: string | undefined;
	const listen = (e: Event) =>
		(html = (e as CustomEvent<{ patch: Partial<Draft> }>).detail.patch.html);
	el.addEventListener('mail-draft-change', listen);
	change(box);
	box.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
	el.removeEventListener('mail-draft-change', listen);
	return html!;
}

describe('cidUrlsOf', () => {
	it("names each part's cid: URL by its Content-ID in lower case, the first of each", () => {
		const draftPart = (blobId: string, cid?: string): DraftAttachment => ({
			blobId,
			name: blobId,
			type: 'image/png',
			size: 4,
			...(cid ? { cid } : {}),
		});
		const parts = [
			draftPart('a', 'Logo@example.test'),
			draftPart('b', 'logo@EXAMPLE.test'),
			draftPart('c'),
			draftPart('d', 'line art@example.test'),
		];
		expect([...cidUrlsOf(parts)]).toEqual([
			['logo@example.test', 'cid:Logo@example.test'],
			['line art@example.test', 'cid:line%20art@example.test'],
		]);
	});
});

describe('<mail-compose> pictures', () => {
	it('keeps the cid: of a forwarded picture in the draft after an edit, before and once it shows', async () => {
		const urls = objectUrls();
		const slow = slowDownloads();
		const el = await mount(forward(), slow.download);
		expect(slow.calls.map((call) => call.part.cid)).toEqual(['logo@example.test']);
		// While its bytes are coming, the picture is no broken cid: link, and an edit keeps it.
		expect(pictures(el).map((img) => img.getAttribute('src'))).toEqual([null]);
		expect(sources(edit(el))).toEqual(['cid:logo@example.test']);
		slow.calls[0]!.finish(PNG);
		await vi.waitFor(() => expect(pictures(el)[0]!.getAttribute('src')).toBe('blob:test/1'));
		expect(urls.made.map((blob) => blob.type)).toEqual(['image/png']);
		const html = edit(el);
		expect(sources(html)).toEqual(['cid:logo@example.test']);
		expect(html).not.toMatch(/blob:|data:|data-cid/);
		// The alternative text and size of the picture stay with it.
		expect(html).toMatch(/<img [^>]*alt="Logo"/);
		expect(html).toMatch(/<img [^>]*width="96"/);
	});

	it('shows and keeps the pictures a draft loads as backgrounds, too', async () => {
		objectUrls();
		const slow = slowDownloads();
		const html =
			'<table><tbody><tr><td background="cid:logo@example.test">Cell</td></tr></tbody></table>' +
			'<div style="background:url(cid:logo@example.test)">Box</div>';
		const el = await mount({ ...forward(), html }, slow.download);
		const cell = () => editor(el).querySelector('td')!;
		const box = () => editor(el).querySelector('div')!;
		const kept = (handed: string) => {
			expect(attributes(handed, 'td', 'background')).toEqual(['cid:logo@example.test']);
			expect(attributes(handed, 'div', 'style')).toEqual([
				'background:url("cid:logo@example.test")',
			]);
			expect(handed).not.toMatch(/blob:|data-cid/);
		};
		// While the bytes are coming, nothing loads from a cid: URL in an attribute.
		expect(cell().getAttribute('background')).toBeNull();
		expect(box().getAttribute('style')).toBe('background:url("cid:logo@example.test")');
		expect(files(el)).toEqual(['notes.txt']);
		kept(edit(el));
		slow.calls[0]!.finish(PNG);
		await vi.waitFor(() => expect(cell().getAttribute('background')).toBe('blob:test/1'));
		expect(box().getAttribute('style')).toBe('background:url("blob:test/1")');
		kept(edit(el));
	});

	it('keeps a style whole whatever the Content-ID it loads from holds', async () => {
		objectUrls();
		// `$'` and `$&` mean something to a string replacement; here they are only text.
		const cid = "logo$'$&@example.test";
		const draft = forward();
		const style = `background:url("cid:${cid}");color:red`;
		const html = `<div style="${style.replaceAll('"', '&quot;')}">Box</div>`;
		const logo = { ...draft.attachments[0]!, cid };
		const slow = slowDownloads();
		const el = await mount({ ...draft, html, attachments: [logo] }, slow.download);
		const box = () => editor(el).querySelector('div')!;
		expect(box().getAttribute('style')).toBe(style);
		expect(attributes(edit(el), 'div', 'style')).toEqual([style]);
		slow.calls[0]!.finish(PNG);
		await vi.waitFor(() =>
			expect(box().getAttribute('style')).toBe('background:url("blob:test/1");color:red'),
		);
		expect(attributes(edit(el), 'div', 'style')).toEqual([style]);
	});

	it('shows an SVG picture from a data: URL and keeps its cid: in the draft', async () => {
		const urls = objectUrls();
		const el = await mount(forward('image/svg+xml'), async () => SVG);
		await vi.waitFor(() =>
			expect(pictures(el)[0]!.getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/),
		);
		expect(urls.made).toEqual([]);
		expect(sources(edit(el))).toEqual(['cid:logo@example.test']);
	});

	it('shows the pictures of a draft reopened to edit', async () => {
		objectUrls();
		const saved = { ...original(), id: 'd1', keywords: { $draft: true as const } };
		const el = await mount(draftFromMessage(saved, undefined), async () => PNG);
		await vi.waitFor(() => expect(pictures(el)[0]!.getAttribute('src')).toBe('blob:test/1'));
		expect(sources(edit(el))).toEqual(['cid:logo@example.test']);
	});

	it('keeps the cid: of a picture whose bytes cannot be read', async () => {
		objectUrls();
		for (const download of [async () => null, () => Promise.reject(new Error('offline'))]) {
			const el = await mount(forward(), download);
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(pictures(el).map((img) => img.getAttribute('src'))).toEqual([null]);
			expect(sources(edit(el))).toEqual(['cid:logo@example.test']);
			el.remove();
		}
	});

	it('keeps the cid: of a picture without anything to read it with', async () => {
		const el = await mount(forward());
		expect(sources(edit(el))).toEqual(['cid:logo@example.test']);
	});

	it('lists the files of a draft but not the pictures its editor shows', async () => {
		objectUrls();
		const el = await mount(forward(), async () => PNG);
		expect(files(el)).toEqual(['notes.txt']);
		// Taken out of the text, the picture is still a part of the draft: it is listed, to remove.
		edit(el, (box) => box.querySelector('img')!.remove());
		await settle(el);
		expect(files(el)).toEqual(['logo.png', 'notes.txt']);
	});

	it('lets the pictures go with their draft, and drops those that arrive too late', async () => {
		const urls = objectUrls();
		const slow = slowDownloads();
		const el = await mount(forward(), slow.download);
		slow.calls[0]!.finish(PNG);
		await vi.waitFor(() => expect(pictures(el)[0]!.getAttribute('src')).toBe('blob:test/1'));
		// The next draft: the last one's picture is let go, and one still coming for it is dropped.
		el.compose = composeState(forward(), 2);
		await settle(el);
		expect(urls.revoked).toEqual(['blob:test/1']);
		el.compose = composeState(forward(), 3);
		await settle(el);
		slow.calls[1]!.finish(PNG);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(urls.made).toHaveLength(1);
		slow.calls[2]!.finish(PNG);
		await vi.waitFor(() => expect(pictures(el)[0]!.getAttribute('src')).toBe('blob:test/2'));
		// The window goes: so do its pictures.
		el.remove();
		expect(urls.revoked).toEqual(['blob:test/1', 'blob:test/2']);
	});

	it('shows the pictures once it is given something to read them with, and again when moved', async () => {
		const urls = objectUrls();
		const el = await mount(forward());
		expect(pictures(el)[0]!.getAttribute('src')).toBeNull();
		el.download = async () => PNG;
		await vi.waitFor(() => expect(pictures(el)[0]!.getAttribute('src')).toBe('blob:test/1'));
		// Moved in the page: the pictures go with it when it leaves and come back when it returns.
		el.remove();
		expect(urls.revoked).toEqual(['blob:test/1']);
		document.body.append(el);
		await vi.waitFor(() => expect(pictures(el)[0]!.getAttribute('src')).toBe('blob:test/2'));
		expect(sources(edit(el))).toEqual(['cid:logo@example.test']);
	});

	it("keeps the draft's own pictures in pasted HTML, and nothing else it loads", async () => {
		objectUrls();
		const el = await mount(forward(), async () => PNG);
		await vi.waitFor(() => expect(pictures(el)[0]!.getAttribute('src')).toBe('blob:test/1'));
		// jsdom has no editing commands: the paste lands at the end of the editor.
		Object.assign(document, {
			execCommand: (command: string, _ui: boolean, value: string) => {
				if (command === 'insertHTML') editor(el).insertAdjacentHTML('beforeend', value);
				return true;
			},
		});
		Object.defineProperty(editor(el), 'innerText', { get: () => editor(el).textContent });
		let html = '';
		el.addEventListener('mail-draft-change', (e) => {
			html = (e as CustomEvent<{ patch: Partial<Draft> }>).detail.patch.html ?? '';
		});
		const paste = new Event('paste', { bubbles: true, cancelable: true });
		// A copy of the picture from the editor itself, another page's picture of this draft, and
		// pictures that are not this draft's.
		const copied =
			'<p><img src="blob:test/1" alt="Copy"><img src="cid:LOGO@example.test" alt="Named">' +
			'<img src="blob:test/99" alt="Other"><img src="cid:other@example.test" alt="Unknown"></p>';
		Object.defineProperty(paste, 'clipboardData', {
			value: { getData: (kind: string) => (kind === 'text/html' ? copied : '') },
		});
		editor(el).dispatchEvent(paste);
		expect(paste.defaultPrevented).toBe(true);
		expect(pictures(el).map((img) => img.getAttribute('src'))).toEqual([
			'blob:test/1',
			'blob:test/1',
			'blob:test/1',
			null,
			null,
		]);
		expect(sources(html)).toEqual([
			'cid:logo@example.test',
			'cid:logo@example.test',
			'cid:logo@example.test',
			null,
			null,
		]);
	});
});
