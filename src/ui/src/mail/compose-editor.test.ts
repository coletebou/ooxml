// @vitest-environment jsdom
import {
	composeDraft,
	ENGLISH_QUOTE_FORMAT,
	type Draft,
	type DraftAttachment,
	type MailAttachment,
	type MailMessage,
} from 'ooxml-core/mail';
import { draftHtml, editorHtml } from './compose-editor';
import { DraftPictures } from './compose-pictures';

afterEach(() => vi.unstubAllGlobals());

/** Two parts of a body: read as one text, the comment the first leaves open hides the second. */
const PARTS = ['<p>First part<!--', '<p>Second part</p>'];

/** A message whose HTML body came in `htmlParts` (none: a text message). */
function message(
	htmlParts: readonly string[] | null,
	attachments: readonly MailAttachment[] = [],
): MailMessage {
	return {
		id: 'm1',
		threadId: 'm1',
		blobId: 'm1-raw',
		mailboxIds: ['inbox'],
		keywords: {},
		receivedAt: Date.UTC(2026, 9, 21),
		size: 100,
		messageId: ['m1@example.test'],
		inReplyTo: [],
		references: [],
		from: [{ name: 'Ada', email: 'ada@example.test' }],
		to: [{ name: 'Sam', email: 'sam@example.test' }],
		cc: [],
		bcc: [],
		replyTo: [],
		subject: 'Parts',
		preview: '',
		hasAttachment: false,
		text: 'First part Second part',
		html: htmlParts ? htmlParts.join('') : null,
		...(htmlParts && htmlParts.length > 1 ? { htmlParts } : {}),
		attachments,
	};
}

/** `html` parsed as one document, as the editor parses a draft's HTML. */
const parsed = (html: string): HTMLElement =>
	new DOMParser().parseFromString(html, 'text/html').body;

/** What the editor shows of a draft, as <mail-compose> starts it: its parts' pictures by `cid:`. */
function shown(draft: Draft): HTMLElement {
	const pictures = new DraftPictures(
		() => null,
		() => null,
		() => {},
	);
	pictures.start(draft.attachments);
	return parsed(editorHtml(draft, pictures));
}

describe('draftHtml', () => {
	it('keeps every part of a body sent in several, whatever one leaves open', () => {
		expect(parsed(PARTS.join('')).textContent).toBe('First part');
		expect(parsed(draftHtml(message(PARTS), [])!).textContent).toBe('First partSecond part');
	});

	it('quotes every part inside the quote of a reply, and the editor shows them there', () => {
		const draft = composeDraft('reply', message(PARTS), {
			identity: null,
			me: [],
			format: ENGLISH_QUOTE_FORMAT,
			draftHtml,
		});
		for (const body of [parsed(draft.html!), shown(draft)])
			expect(body.querySelector('blockquote[type="cite"]')?.textContent).toBe(
				'First partSecond part',
			);
	});

	it('keeps the pictures of the parts it is given by cid:, and nothing else a part loads', () => {
		const logo: MailAttachment = {
			partId: '2',
			blobId: 'b2',
			name: 'logo.png',
			type: 'image/png',
			size: 4,
			disposition: 'inline',
			cid: 'Logo@example.test',
		};
		const parts: DraftAttachment[] = [
			{ blobId: 'b2', name: 'logo.png', type: 'image/png', size: 4, cid: logo.cid!, inline: true },
		];
		const source = message(
			[
				'<p><img src="cid:logo@example.test" alt="Logo"><!--',
				[
					'<p><img src="cid:other@example.test" alt="Other">',
					'<img src="https://t.example/p.png" alt="Remote">',
					'<img src="data:image/png;base64,AAAA" alt="Data"></p>',
					'<p style="background:url(https://t.example/b.png)">Box</p><script>steal()</script>',
				].join(''),
			],
			[logo],
		);
		const html = draftHtml(source, parts)!;
		expect(
			[...parsed(html).querySelectorAll('img')].map((img) => [img.alt, img.getAttribute('src')]),
		).toEqual([
			['Logo', 'cid:Logo@example.test'],
			['Other', null],
			['Remote', null],
			['Data', 'data:image/png;base64,AAAA'],
		]);
		expect(parsed(html).textContent).toBe('Box');
		expect(html).not.toMatch(/https:|<script|steal/);
		// An answer carries no parts, so its quote keeps none of their pictures.
		const answer = parsed(draftHtml(source, [])!);
		expect(answer.querySelector('img[alt="Logo"]')?.getAttribute('src')).toBeNull();
	});

	it("keeps the direction and language of the message body, its own or its html element's", () => {
		// The editor takes only the content of a body, so they go on a block round it: a quote of a
		// message written right to left stays right to left.
		const rtl = '<html dir="rtl" lang="ar"><body><p>x</p></body></html>';
		expect(draftHtml(message([rtl]), [])).toBe('<div dir="rtl" lang="ar"><p>x</p></div>');
		// The body's own win over its html element's, as a browser reads them.
		const own = '<html dir="rtl" lang="ar"><body dir="ltr"><p>x</p></body></html>';
		expect(draftHtml(message([own]), [])).toBe('<div dir="ltr" lang="ar"><p>x</p></div>');
		// A value stays in its attribute.
		const odd = draftHtml(message(['<body dir=\'rtl" onclick="steal()\'><p>x</p></body>']), [])!;
		expect(parsed(odd).querySelector('[onclick]')).toBeNull();
		expect(parsed(odd).firstElementChild?.getAttribute('dir')).toBe('rtl" onclick="steal()');
		// The quote of a reply has them, and so does what the editor shows of it.
		const draft = composeDraft('reply', message([rtl]), {
			identity: null,
			me: [],
			format: ENGLISH_QUOTE_FORMAT,
			draftHtml,
		});
		for (const body of [parsed(draft.html!), shown(draft)]) {
			const quoted = body.querySelector('blockquote[type="cite"] [dir]');
			expect([quoted?.getAttribute('dir'), quoted?.getAttribute('lang')]).toEqual(['rtl', 'ar']);
		}
	});

	it('cleans a body sent in one part as the editor does', () => {
		const html = '<p>Hi <b onclick="steal()">there</b><img src="https://t.example/i.png"></p>';
		const pictures = { cidUrls: new Map<string, string>(), refer: (markup: string) => markup };
		expect(draftHtml(message([html]), [])).toBe(editorHtml({ html, text: '' }, pictures));
	});

	it('is null without HTML, and the HTML as sent where there is no DOM to clean it in', () => {
		expect(draftHtml(message(null), [])).toBeNull();
		vi.stubGlobal('DOMParser', undefined);
		expect(draftHtml(message(PARTS), [])).toBe(PARTS.join(''));
	});
});
