// @vitest-environment jsdom
import { createMemoryTransport, type Draft } from 'ooxml-core/mail';
import { editorHtml } from './compose-editor';
import { DraftPictures } from './compose-pictures';
import { createMail, sameMailConnection, type MailConnection } from './store';

const jmap = (auth: Extract<MailConnection, { kind: 'jmap' }>['auth']): MailConnection => ({
	kind: 'jmap',
	url: 'https://mail.example.com',
	auth,
});

describe('sameMailConnection', () => {
	it('treats no connection as the same as no connection', () => {
		expect(sameMailConnection(null, undefined)).toBe(true);
		expect(sameMailConnection(null, { kind: 'demo' })).toBe(false);
	});

	it('compares a demo mailbox by its seed options', () => {
		const files = { xlsx: new Uint8Array([1]) };
		expect(sameMailConnection({ kind: 'demo' }, { kind: 'demo', seed: {} })).toBe(true);
		expect(
			sameMailConnection(
				{ kind: 'demo', seed: { now: 1, files } },
				{ kind: 'demo', seed: { now: 1, files: { ...files } } },
			),
		).toBe(true);
		expect(
			sameMailConnection({ kind: 'demo', seed: { now: 1 } }, { kind: 'demo', seed: { now: 2 } }),
		).toBe(false);
		expect(sameMailConnection({ kind: 'demo', seed: { bulk: 10 } }, { kind: 'demo' })).toBe(false);
		expect(
			sameMailConnection(
				{ kind: 'demo', seed: { files } },
				{ kind: 'demo', seed: { files: { xlsx: new Uint8Array([1]) } } },
			),
		).toBe(false);
	});

	it('compares a server by its address and credentials, written inline or not', () => {
		expect(
			sameMailConnection(
				jmap({ type: 'bearer', token: 't' }),
				jmap({ type: 'bearer', token: 't' }),
			),
		).toBe(true);
		expect(
			sameMailConnection(
				jmap({ type: 'bearer', token: 't' }),
				jmap({ type: 'bearer', token: 'u' }),
			),
		).toBe(false);
		expect(
			sameMailConnection(
				jmap({ type: 'basic', username: 'ada', password: 'p' }),
				jmap({ type: 'basic', username: 'ada', password: 'p' }),
			),
		).toBe(true);
		expect(
			sameMailConnection(
				jmap({ type: 'basic', username: 'ada', password: 'p' }),
				jmap({ type: 'basic', username: 'ada', password: 'q' }),
			),
		).toBe(false);
		expect(
			sameMailConnection(
				jmap({ type: 'bearer', token: 'p' }),
				jmap({ type: 'basic', username: 'p', password: 'p' }),
			),
		).toBe(false);
		const other: MailConnection = {
			kind: 'jmap',
			url: 'https://other.example.com',
			auth: { type: 'bearer', token: 't' },
		};
		expect(sameMailConnection(jmap({ type: 'bearer', token: 't' }), other)).toBe(false);
	});

	it('compares a transport of your own by identity', () => {
		const transport = createMemoryTransport();
		expect(
			sameMailConnection({ kind: 'transport', transport }, { kind: 'transport', transport }),
		).toBe(true);
		expect(
			sameMailConnection(
				{ kind: 'transport', transport },
				{ kind: 'transport', transport: createMemoryTransport() },
			),
		).toBe(false);
		expect(sameMailConnection({ kind: 'transport', transport }, { kind: 'demo' })).toBe(false);
	});
});

/**
 * A message whose HTML body came in two parts around its logo. Read as one text, the comment the
 * first part leaves open hides the second.
 */
const TWO_PARTS = [
	'From: Ada <ada@example.com>',
	'To: You <you@example.com>',
	'Subject: Two parts',
	'Message-ID: <two@example.com>',
	'Date: Wed, 21 Oct 2026 09:00:00 +0000',
	'MIME-Version: 1.0',
	'Content-Type: multipart/mixed; boundary=b',
	'',
	'--b',
	'Content-Type: text/html; charset=utf-8',
	'',
	'<p>First part<!--',
	'--b',
	'Content-Type: image/png',
	'Content-ID: <logo@example.test>',
	'Content-Disposition: inline',
	'Content-Transfer-Encoding: base64',
	'',
	'iVBORw==',
	'--b',
	'Content-Type: text/html; charset=utf-8',
	'',
	'<p>Second part</p><p><img src="cid:logo@example.test" alt="Logo"></p>',
	'--b--',
	'',
].join('\r\n');

const parsed = (html: string): HTMLElement =>
	new DOMParser().parseFromString(html, 'text/html').body;

describe('createMail', () => {
	it('starts answers, forwards and reopened drafts with every part of an HTML body', async () => {
		const memory = createMemoryTransport();
		const bytes = new TextEncoder().encode(TWO_PARTS);
		const { id } = await memory.importMessage(bytes, 'inbox');
		const { id: saved } = await memory.importMessage(bytes, 'drafts');
		const mail = createMail({ config: { kind: 'transport', transport: memory }, storage: null });
		const draft = (): Draft => mail.getState().compose!.draft;
		/** What the editor shows of the open draft, as <mail-compose> starts it. */
		const shown = (): HTMLElement => {
			const pictures = new DraftPictures(
				() => null,
				() => null,
				() => {},
			);
			pictures.start(draft().attachments);
			return parsed(editorHtml(draft(), pictures));
		};
		const logo = (body: HTMLElement) => body.querySelector('img[alt="Logo"]')?.getAttribute('src');
		try {
			await vi.waitFor(() => expect(mail.getState().status).toBe('ready'));
			expect(await mail.compose('forward', id)).toBe(true);
			expect(shown().textContent).toContain('First partSecond part');
			expect(logo(shown())).toBe('cid:logo@example.test');
			// Sent as it opened, the forward holds every part too, and its picture by cid:.
			mail.updateDraft({ to: [{ name: 'Ben', email: 'ben@example.com' }] });
			expect(await mail.send()).toBe(true);
			const [sentId] = (await memory.query({ mailboxId: 'sent' })).ids;
			const sent = parsed((await memory.message(sentId!)).html!);
			expect(sent.textContent).toContain('First partSecond part');
			expect(logo(sent)).toBe('cid:logo@example.test');
			expect(await mail.compose('reply', id)).toBe(true);
			expect(shown().querySelector('blockquote')?.textContent).toBe('First partSecond part');
			await mail.discardDraft();
			expect(await mail.editDraft(saved)).toBe(true);
			expect(shown().textContent).toBe('First partSecond part');
			expect(logo(shown())).toBe('cid:logo@example.test');
		} finally {
			mail.destroy();
		}
	});
});
