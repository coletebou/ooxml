// @vitest-environment jsdom
import {
	createJmapTransport,
	createMemoryTransport,
	type MailMessage,
	type OpenMessageView,
} from 'ooxml-core/mail';
import type { MailHtmlFrame } from './html-frame';
import { defineMailReadingPane, type InlineUrls, type MailReadingPane } from './reading-pane';

beforeAll(() => defineMailReadingPane());
afterEach(() => document.body.replaceChildren());

/** An HTML part that leaves a comment open, a plain text footer, then more HTML, as an `.eml`. */
const RAW = [
	'From: Ada <ada@example.com>',
	'Subject: Parts',
	'Content-Type: multipart/mixed; boundary=b',
	'',
	'--b',
	'Content-Type: text/html',
	'',
	'<p>Hello<img src="https://t.example/a.png"><!--',
	'--b',
	'Content-Type: text/plain',
	'',
	'Footer',
	'--b',
	'Content-Type: text/html',
	'',
	'<p>Bye<img src="https://t.example/b.png"></p>',
	'--b--',
	'',
].join('\r\n');

/** The same message as a JMAP server sends it (RFC 8621 `Email/get`, bodies fetched). */
const PARTS = [
	{ partId: '1', type: 'text/html' },
	{ partId: '2', type: 'text/plain' },
	{ partId: '3', type: 'text/html' },
];
const EMAIL = {
	id: 'E1',
	threadId: 'T1',
	blobId: 'B1',
	mailboxIds: { inbox: true },
	keywords: { $seen: true },
	receivedAt: '2026-10-20T09:00:00Z',
	from: [{ name: 'Ada', email: 'ada@example.com' }],
	subject: 'Parts',
	textBody: PARTS,
	htmlBody: PARTS,
	bodyValues: {
		'1': { value: '<p>Hello<img src="https://t.example/a.png"><!--', isTruncated: false },
		'2': { value: 'Footer', isTruncated: false },
		'3': { value: '<p>Bye<img src="https://t.example/b.png"></p>', isTruncated: false },
	},
	attachments: [],
};

/** A JMAP server (RFC 8620) of one mail account whose `Email/get` finds `email`. */
function jmapServer(email: Record<string, unknown>): typeof fetch {
	const json = (value: unknown): Response =>
		new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
	const session = {
		capabilities: { 'urn:ietf:params:jmap:core': {}, 'urn:ietf:params:jmap:mail': {} },
		accounts: {
			A: {
				name: 'me@example.com',
				isPersonal: true,
				isReadOnly: false,
				accountCapabilities: { 'urn:ietf:params:jmap:mail': {} },
			},
		},
		primaryAccounts: { 'urn:ietf:params:jmap:mail': 'A' },
		username: 'me@example.com',
		apiUrl: 'https://jmap.example/api',
		downloadUrl: 'https://jmap.example/download/{accountId}/{blobId}/{name}?accept={type}',
		uploadUrl: 'https://jmap.example/upload/{accountId}',
		state: 's1',
	};
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		if (String(input) !== session.apiUrl) return json(session);
		const { methodCalls } = JSON.parse(String(init?.body)) as {
			methodCalls: [string, unknown, string][];
		};
		return json({
			methodResponses: methodCalls.map(([name, , id]) =>
				name === 'Email/get'
					? [name, { accountId: 'A', state: 'e1', list: [email], notFound: [] }, id]
					: ['error', { type: 'unknownMethod' }, id],
			),
			sessionState: 's1',
		});
	}) as typeof fetch;
}

/** A message read from `raw` as an imported `.eml` is. */
async function imported(raw: string): Promise<MailMessage> {
	const transport = createMemoryTransport();
	const { id } = await transport.importMessage(new TextEncoder().encode(raw), 'inbox');
	return transport.message(id);
}

/** A message read from a JMAP server that sends `email`. */
async function fromJmap(email: Record<string, unknown>): Promise<MailMessage> {
	const transport = createJmapTransport({
		url: 'https://jmap.example/session',
		auth: { type: 'bearer', token: 't' },
		fetch: jmapServer(email),
		push: 'off',
	});
	try {
		return await transport.message(email.id as string);
	} finally {
		transport.close();
	}
}

/** An HTML body that shows a picture of its own (`cid:`), and that picture. */
const PICTURE = [
	'Subject: Picture',
	'Content-Type: multipart/related; boundary=b',
	'',
	'--b',
	'Content-Type: text/html',
	'',
	'<p>Logo<img src="cid:logo@x"></p>',
	'--b',
	'Content-Type: image/png',
	'Content-ID: <logo@x>',
	'Content-Transfer-Encoding: base64',
	'',
	'iVBORw0KGgo=',
	'--b--',
	'',
].join('\r\n');

/**
 * What the reading pane shows of `message`, its pictures found by `inlineUrls` when given: the
 * pane, its frame, the text there, and the blocked note.
 */
async function read(message: MailMessage, inlineUrls?: InlineUrls) {
	const pane = document.createElement('mail-reading-pane') as MailReadingPane;
	if (inlineUrls) pane.inlineUrls = inlineUrls;
	pane.conversation = {
		id: message.id,
		subject: message.subject,
		messages: [{ summary: message, depth: 0, message, error: null }],
	};
	document.body.append(pane);
	await pane.updateComplete;
	const frame = pane.shadowRoot!.querySelector<MailHtmlFrame>('mail-html-frame')!;
	await frame.updateComplete;
	// The frame tells the pane how much it blocked, which then shows the note.
	await pane.updateComplete;
	const srcdoc = frame.shadowRoot!.querySelector('iframe')!.srcdoc;
	return {
		pane,
		frame,
		text: new DOMParser().parseFromString(srcdoc, 'text/html').body.textContent,
		note: pane.shadowRoot!.querySelector('.remote span')?.textContent ?? null,
	};
}

/**
 * The count of each `mail-remote-blocked` from here on: a frame sends one each time it cleans its
 * message and writes it again, which reloads it.
 */
function frameWrites(): { counts: number[]; stop(): void } {
	const counts: number[] = [];
	const count = (event: Event): void => {
		counts.push((event as CustomEvent<{ count: number }>).detail.count);
	};
	// The pane stops the event at the frame, so it is counted on its way there.
	document.addEventListener('mail-remote-blocked', count, { capture: true });
	return {
		counts,
		stop: () => document.removeEventListener('mail-remote-blocked', count, { capture: true }),
	};
}

describe('<mail-reading-pane>', () => {
	it('shows each part of an imported message on its own, counting what they all block', async () => {
		const { text, note } = await read(await imported(RAW));
		expect(text).toBe('HelloFooterBye');
		expect(note).toBe('Blocked 2 remote images or styles to protect your privacy.');
	});

	it('shows each part of a JMAP email on its own, counting what they all block', async () => {
		const { text, note } = await read(await fromJmap(EMAIL));
		expect(text).toBe('HelloFooterBye');
		expect(note).toBe('Blocked 2 remote images or styles to protect your privacy.');
	});

	it('shows a body sent in one part as before', async () => {
		const one = await imported(
			'Subject: One\r\nContent-Type: text/html\r\n\r\n<p>One<!-- note --><img src="https://t.example/a.png"></p>',
		);
		expect(one.htmlParts).toBeUndefined();
		const { frame, text, note } = await read(one);
		expect([frame.html, frame.htmlParts, text]).toEqual([one.html, null, 'One']);
		expect(note).toBe('Blocked 1 remote image or style to protect your privacy.');
	});

	it('writes a message without pictures into its frame once, however often the pane draws', async () => {
		const writes = frameWrites();
		try {
			const { pane, frame, note } = await read(
				await imported(
					'Subject: One\r\nContent-Type: text/html\r\n\r\n<p>One<img src="https://t.example/a.png"></p>',
				),
			);
			expect(note).toBe('Blocked 1 remote image or style to protect your privacy.');
			// A change elsewhere, such as new folder counts, draws the pane again.
			pane.mailboxes = [];
			await pane.updateComplete;
			await frame.updateComplete;
			expect(writes.counts).toEqual([1]);
		} finally {
			writes.stop();
		}
	});

	it('writes a message with pictures again only once they are found', async () => {
		const writes = frameWrites();
		try {
			let found: (urls: ReadonlyMap<string, string>) => void = () => {};
			const { pane, frame } = await read(
				await imported(PICTURE),
				() => new Promise((resolve) => (found = resolve)),
			);
			// Until its pictures are found, drawing the pane again does not write the message again.
			pane.mailboxes = [];
			await pane.updateComplete;
			await frame.updateComplete;
			expect(writes.counts).toEqual([0]);
			found(new Map([['logo@x', 'data:image/png;base64,AAAA']]));
			await new Promise((resolve) => setTimeout(resolve, 0));
			await pane.updateComplete;
			await frame.updateComplete;
			expect(writes.counts).toEqual([0, 0]);
			expect(frame.shadowRoot!.querySelector('iframe')!.srcdoc).toContain(
				'src="data:image/png;base64,AAAA"',
			);
		} finally {
			writes.stop();
		}
	});

	it('opens a conversation whose message shows a picture in one update', async () => {
		const message = await imported(PICTURE);
		const pane = document.createElement('mail-reading-pane') as MailReadingPane;
		// Never found: only what opening the conversation takes is counted.
		pane.inlineUrls = () => new Promise(() => {});
		const updates = vi.spyOn(pane as unknown as { update(changed: unknown): void }, 'update');
		try {
			pane.conversation = {
				id: message.id,
				subject: message.subject,
				messages: [{ summary: message, depth: 0, message, error: null }],
			};
			document.body.append(pane);
			await pane.updateComplete;
			await pane.shadowRoot!.querySelector<MailHtmlFrame>('mail-html-frame')!.updateComplete;
			await pane.updateComplete;
			expect(updates).toHaveBeenCalledTimes(1);
		} finally {
			updates.mockRestore();
		}
	});

	it('keeps the pictures found for a conversation out of the one opened since', async () => {
		let found: (urls: ReadonlyMap<string, string>) => void = () => {};
		const message = await imported(PICTURE);
		const { pane } = await read(message, () => new Promise((resolve) => (found = resolve)));
		const other = {
			...(await imported('Subject: Other\r\nContent-Type: text/html\r\n\r\n<p>Other</p>')),
			id: 'other',
		};
		pane.conversation = {
			id: other.id,
			subject: other.subject,
			messages: [{ summary: other, depth: 0, message: other, error: null }],
		};
		await pane.updateComplete;
		found(new Map([['logo@x', 'data:image/png;base64,AAAA']]));
		await new Promise((resolve) => setTimeout(resolve, 0));
		await pane.updateComplete;
		expect([...pane.inline.keys()]).toEqual([]);
	});

	it('opens with the newest message and the unread ones expanded, wherever the thread puts them', async () => {
		const HOUR = 3_600_000;
		const view = (id: string, sentAt: number, depth: number, read = true): OpenMessageView => ({
			summary: {
				id,
				threadId: 't',
				blobId: `${id}-raw`,
				mailboxIds: ['inbox'],
				keywords: read ? { $seen: true } : {},
				receivedAt: sentAt,
				sentAt,
				size: 1,
				messageId: [],
				inReplyTo: [],
				references: [],
				from: [{ name: 'Ada', email: 'ada@example.com' }],
				to: [],
				cc: [],
				bcc: [],
				replyTo: [],
				subject: 'Plans',
				preview: `Message ${id}`,
				hasAttachment: false,
			},
			depth,
			message: null,
			error: null,
		});
		const pane = document.createElement('mail-reading-pane') as MailReadingPane;
		document.body.append(pane);
		const expanded = async (messages: OpenMessageView[]): Promise<string[]> => {
			pane.conversation = { id: messages[0]!.summary.id, subject: 'Plans', messages };
			await pane.updateComplete;
			return [...pane.shadowRoot!.querySelectorAll('article.message')].flatMap((article, i) =>
				article.classList.contains('open') ? [messages[i]!.summary.id] : [],
			);
		};
		// Thread order is depth first: a, its reply b with b's reply d, then a's later reply c,
		// written before d. Every message read: only the newest, d, opens.
		expect(
			await expanded([
				view('a', 0, 0),
				view('b', HOUR, 1),
				view('d', 4 * HOUR, 2),
				view('c', 2 * HOUR, 1),
			]),
		).toEqual(['d']);
		// Another conversation, with an unread message: that one opens too.
		expect(
			await expanded([view('e', 0, 0, false), view('f', HOUR, 1), view('g', 2 * HOUR, 1)]),
		).toEqual(['e', 'g']);
		// Two written at the same time: the later one in reading order counts as the newest.
		expect(await expanded([view('h', 0, 0), view('i', HOUR, 1), view('j', HOUR, 1)])).toEqual([
			'j',
		]);
	});

	it('sends what its toolbar does with the open conversation', async () => {
		const { pane } = await read(
			await imported('Subject: One\r\nContent-Type: text/html\r\n\r\n<p>One</p>'),
		);
		const id = pane.conversation!.id;
		pane.mailboxes = [
			{
				id: 'f1',
				name: 'Projects',
				parentId: null,
				role: null,
				sortOrder: 0,
				totalEmails: 0,
				unreadEmails: 0,
				depth: 1,
			},
		];
		await pane.updateComplete;
		const sent: unknown[] = [];
		for (const type of ['mail-action', 'mail-move'])
			pane.addEventListener(type, (event) => sent.push([type, (event as CustomEvent).detail]));
		const toolbar = pane.shadowRoot!.querySelector('[role="toolbar"]')!;
		const labels = () =>
			[...toolbar.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'));
		expect(toolbar.getAttribute('aria-label')).toBe('Conversation actions');
		expect(labels()).toEqual([
			'Back to the list',
			'Archive',
			'Delete',
			'Move to Junk',
			'Mark as unread',
			'Flag',
		]);
		for (const button of toolbar.querySelectorAll('button')) button.click();
		const select = toolbar.querySelector('select')!;
		expect([...select.options].map((option) => option.textContent)).toEqual([
			'Move to...',
			'\u00a0\u00a0Projects',
		]);
		select.value = 'f1';
		select.dispatchEvent(new Event('change'));
		expect(select.value).toBe('');
		expect(sent).toEqual([
			...['close', 'archive', 'delete', 'junk', 'unread', 'flag'].map((action) => [
				'mail-action',
				{ action, id },
			]),
			['mail-move', { mailboxId: 'f1', ids: [id] }],
		]);
		// A flagged message makes the flag button take the flag off.
		const [view] = pane.conversation!.messages;
		pane.conversation = {
			...pane.conversation!,
			messages: [{ ...view!, summary: { ...view!.summary, keywords: { $flagged: true } } }],
		};
		await pane.updateComplete;
		expect(labels().at(-1)).toBe('Remove the flag');
	});
});
