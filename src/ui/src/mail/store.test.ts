// @vitest-environment jsdom
import {
	ENGLISH_QUOTE_FORMAT,
	createMemoryCalendarStore,
	createMemoryContactStore,
	createMemoryTransport,
	emptyContact,
	type Draft,
	type MailMessage,
	type MailNotice,
	type QuoteFormat,
} from 'ooxml-core/mail';
import { editorHtml } from './compose-editor';
import { DraftPictures } from './compose-pictures';
import {
	createMail,
	followQuoteFormat,
	sameMailConnection,
	sameMailOptions,
	type MailConnection,
} from './store';

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

	it('keeps a server whose token comes from one function, whatever token it gives', () => {
		let token = 't';
		const current = () => token;
		const by = (given: () => string) => jmap({ type: 'bearer', token: given });
		expect(sameMailConnection(by(current), by(current))).toBe(true);
		token = 'u';
		expect(sameMailConnection(by(current), by(current))).toBe(true);
		// Another function, or a token in its place, is another connection.
		expect(
			sameMailConnection(
				by(current),
				by(() => token),
			),
		).toBe(false);
		expect(sameMailConnection(by(current), jmap({ type: 'bearer', token: 'u' }))).toBe(false);
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

describe('sameMailOptions', () => {
	it('keeps a client for an equal connection and the same stores, whatever the quote wording', () => {
		const contacts = createMemoryContactStore();
		const options = { config: jmap({ type: 'bearer', token: 'a' }), contacts, storage: null };
		const wording = { attribution: () => 'Wrote:', forwardHeader: () => [] };
		expect(
			sameMailOptions(options, { ...options, config: jmap({ type: 'bearer', token: 'a' }) }),
		).toBe(true);
		expect(sameMailOptions(options, { ...options, quoteFormat: wording })).toBe(true);
		expect(sameMailOptions(null, undefined)).toBe(true);
	});

	it('makes a new one for another connection, store or storage, or for none', () => {
		const options = { config: jmap({ type: 'bearer', token: 'a' }) };
		for (const other of [
			{ ...options, config: jmap({ type: 'bearer', token: 'b' }) },
			{ ...options, contacts: createMemoryContactStore() },
			{ ...options, calendar: createMemoryCalendarStore() },
			{ ...options, storage: null },
			null,
		])
			expect(sameMailOptions(options, other)).toBe(false);
	});
});

describe('followQuoteFormat', () => {
	it('quotes with the wording given now, else in English', () => {
		const source = { from: [{ name: 'Ada', email: 'ada@example.com' }], subject: 'Plans' };
		let wording: QuoteFormat | undefined;
		const format = followQuoteFormat(() => wording);
		const message = source as unknown as MailMessage;
		expect(format.attribution(message)).toBe(ENGLISH_QUOTE_FORMAT.attribution(message));
		wording = { attribution: (m) => `${m.subject}, said:`, forwardHeader: () => ['Forwarded'] };
		expect([format.attribution(message), format.forwardHeader(message)]).toEqual([
			'Plans, said:',
			['Forwarded'],
		]);
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

describe('createMail on the browser storage', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		localStorage.clear();
	});

	const names = (mail: ReturnType<typeof createMail>): string[] =>
		mail.getState().contacts.map((contact) => contact.name);
	const open = (storage?: null) => {
		const mail = createMail({
			config: { kind: 'transport', transport: createMemoryTransport() },
			...(storage === null ? { storage } : {}),
		});
		const notices: MailNotice[] = [];
		mail.onNotice((notice) => notices.push(notice));
		return { mail, notices };
	};

	it('reads a full storage, and says that a change it refuses is not stored', async () => {
		const ada = { ...emptyContact('ada', 0), name: 'Ada' };
		localStorage.setItem('ooxml-mail:contacts:transport', JSON.stringify([ada]));
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
		});
		const { mail, notices } = open();
		try {
			await vi.waitFor(() => expect(names(mail)).toEqual(['Ada']));
			await mail.saveContact({ ...emptyContact('grace', 0), name: 'Grace' });
			expect(names(mail)).toEqual(['Ada', 'Grace']);
			expect(notices).toContainEqual({ kind: 'error', action: 'contacts', code: 'storage' });
		} finally {
			mail.destroy();
		}
	});

	it('says that a change is not stored where the page may not use the storage', async () => {
		vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
			throw new DOMException('Access is denied for this document.', 'SecurityError');
		});
		const { mail, notices } = open();
		try {
			await vi.waitFor(() => expect(mail.getState().status).toBe('ready'));
			await mail.saveContact({ ...emptyContact('grace', 0), name: 'Grace' });
			expect(names(mail)).toEqual(['Grace']);
			expect(notices).toContainEqual({ kind: 'error', action: 'contacts', code: 'storage' });
		} finally {
			mail.destroy();
		}
	});

	it('says nothing for a host that keeps them in memory only', async () => {
		const { mail, notices } = open(null);
		try {
			await vi.waitFor(() => expect(mail.getState().status).toBe('ready'));
			await mail.saveContact({ ...emptyContact('grace', 0), name: 'Grace' });
			expect(names(mail)).toEqual(['Grace']);
			expect(notices.filter((notice) => notice.kind === 'error')).toEqual([]);
		} finally {
			mail.destroy();
		}
	});
});
