// @vitest-environment jsdom
import { createJmapTransport, createMemoryTransport, type MailMessage } from 'ooxml-core/mail';
import type { MailHtmlFrame } from './html-frame';
import { defineMailReadingPane, type MailReadingPane } from './reading-pane';

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

/** What the reading pane shows of `message`: its frame, the text there, and the blocked note. */
async function read(message: MailMessage) {
	const pane = document.createElement('mail-reading-pane') as MailReadingPane;
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
		frame,
		text: new DOMParser().parseFromString(srcdoc, 'text/html').body.textContent,
		note: pane.shadowRoot!.querySelector('.remote span')?.textContent ?? null,
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
});
