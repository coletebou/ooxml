import { createMailClient } from './client';
import type { MailClient, MailNotice } from './client-types';
import { createMemoryContactStore } from './contacts';
import { createMemoryTransport, type MemoryTransport } from './memory-transport';
import type { SeedMessage } from './memory-messages';
import { until } from './test-support/client';
import { MailTransportError, type MailChange, type MailTransport } from './transport';

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);
const ada = { name: 'Ada', email: 'ada@example.com' };
const me = { name: 'You', email: 'you@example.com' };

function seed(): SeedMessage[] {
	return [
		{
			id: 'r1',
			mailboxId: 'inbox',
			from: ada,
			to: [me],
			subject: 'Plan',
			text: 'First',
			messageId: 'r1@x',
			receivedAt: T0,
			unread: true,
		},
		{
			id: 'r2',
			mailboxId: 'inbox',
			from: ada,
			to: [me],
			subject: 'Re: Plan',
			text: 'Second',
			messageId: 'r2@x',
			inReplyTo: ['r1@x'],
			references: ['r1@x'],
			receivedAt: T0 + 60_000,
			unread: true,
		},
		{
			id: 'o1',
			mailboxId: 'inbox',
			from: { name: 'Ben', email: 'ben@example.com' },
			to: [me],
			subject: 'Lunch',
			text: 'Noon?',
			receivedAt: T0 - 60_000,
		},
	];
}

function setup(options: { timers?: boolean } = {}) {
	const transport: MemoryTransport = createMemoryTransport({
		messages: seed(),
		now: () => T0 + 3_600_000,
	});
	const pending: (() => void)[] = [];
	const notices: MailNotice[] = [];
	const client = createMailClient({
		transport,
		contacts: createMemoryContactStore(),
		...(options.timers
			? {
					setTimeout: (callback: () => void) => pending.push(callback),
					clearTimeout: () => undefined,
				}
			: {}),
	});
	client.onNotice((notice) => notices.push(notice));
	return { transport, client, pending, notices };
}

/** A client whose transport cannot read the body of `r2` until `server.up`, its changes pushed by hand. */
function failingBody() {
	const memory = createMemoryTransport({ messages: seed(), now: () => T0 + 3_600_000 });
	const server = { up: false };
	const listeners: ((change: MailChange) => void)[] = [];
	const pending: (() => void)[] = [];
	const transport: MailTransport = {
		...memory,
		message: async (id) => {
			if (!server.up && id === 'r2') throw new MailTransportError('server', 'Unavailable.');
			return memory.message(id);
		},
		watch: (listener) => {
			listeners.push(listener);
			return () => undefined;
		},
	};
	const client = createMailClient({
		transport,
		setTimeout: (callback: () => void) => pending.push(callback),
		clearTimeout: () => undefined,
	});
	return { client, memory, server, listeners, pending };
}

/** The open conversation's bodies and errors, message by message. */
const bodiesOf = (client: MailClient) =>
	client.getState().open?.messages.map((m) => [m.message?.text ?? null, m.error]);

describe('createMailClient', () => {
	it('connects, opens the Inbox and threads its messages into conversations', async () => {
		const { client } = setup();
		const state = await until(client, (s) => s.status === 'ready' && s.conversations.length > 0);
		expect(state.account?.name).toBe('you@example.com');
		expect(state.mailboxes.map((m) => m.role)).toEqual([
			'inbox',
			'drafts',
			'sent',
			'archive',
			'junk',
			'trash',
		]);
		expect(state.conversations.map((c) => [c.subject, c.count, c.unread])).toEqual([
			['Plan', 2, 2],
			['Lunch', 1, 0],
		]);
		client.setThreaded(false);
		expect(client.getState().conversations).toHaveLength(3);
		client.destroy();
	});

	it('marks a conversation read when it opens and loads its bodies', async () => {
		const { client, transport } = setup();
		await until(client, (s) => s.conversations.length > 0);
		await client.open('r1');
		const open = client.getState().open!;
		expect(open.messages.map((m) => m.message?.text)).toEqual(['First', 'Second']);
		expect(client.getState().conversations[0]!.unread).toBe(0);
		expect((await transport.message('r2')).keywords.$seen).toBe(true);
		client.destroy();
	});

	it('leaves a message unread when its body cannot be read', async () => {
		const memory = createMemoryTransport({ messages: seed(), now: () => T0 + 3_600_000 });
		const transport: MailTransport = {
			...memory,
			message: async (id) => {
				if (id === 'r2') throw new MailTransportError('server', 'Unavailable.');
				return memory.message(id);
			},
		};
		const client = createMailClient({ transport });
		await until(client, (s) => s.conversations.length > 0);
		await client.open('r1');
		expect(client.getState().open?.messages.map((m) => [m.message?.text ?? null, m.error])).toEqual(
			[
				['First', null],
				[null, 'server'],
			],
		);
		expect((await memory.message('r1')).keywords.$seen).toBe(true);
		expect((await memory.message('r2')).keywords.$seen).toBeUndefined();
		client.destroy();
	});

	it('reads a body that could not be read again on an explicit refresh', async () => {
		const { client, server } = failingBody();
		await until(client, (s) => s.conversations.length > 0);
		await client.open('r1');
		expect(bodiesOf(client)).toEqual([
			['First', null],
			[null, 'server'],
		]);
		server.up = true;
		await client.refresh();
		expect(bodiesOf(client)).toEqual([
			['First', null],
			['Second', null],
		]);
		client.destroy();
	});

	it('reads every body again when the server starts over, one that failed too', async () => {
		const { client, server, listeners, pending } = failingBody();
		await until(client, (s) => s.conversations.length > 0);
		await client.open('r1');
		expect(bodiesOf(client)).toEqual([
			['First', null],
			[null, 'server'],
		]);
		// Its state too old to say what changed: the server starts over, and now answers.
		server.up = true;
		for (const listener of listeners) listener({ type: 'reset' });
		for (const run of pending.splice(0)) run();
		await until(client, (s) => s.open?.messages[1]?.message?.text === 'Second');
		expect(bodiesOf(client)).toEqual([
			['First', null],
			['Second', null],
		]);
		client.destroy();
	});

	it('loads the body of a reply that arrives while its conversation is open', async () => {
		const { client, transport } = setup();
		await until(client, (s) => s.conversations.length > 0);
		await client.open('r1');
		transport.deliver({
			id: 'r3',
			mailboxId: 'inbox',
			from: ada,
			to: [me],
			subject: 'Re: Plan',
			text: 'Third',
			messageId: 'r3@x',
			inReplyTo: ['r2@x'],
			references: ['r1@x', 'r2@x'],
			receivedAt: T0 + 120_000,
		});
		const state = await until(
			client,
			(s) => s.open?.messages.length === 3 && s.open.messages.every((m) => m.message !== null),
		);
		expect(state.open?.messages.map((m) => m.message?.text)).toEqual(['First', 'Second', 'Third']);
		client.destroy();
	});

	it('shows changes made elsewhere on refresh, when the server pushes none', async () => {
		const memory = createMemoryTransport({ messages: seed(), now: () => T0 + 3_600_000 });
		// No push: the client learns what changed only when it asks.
		const transport: MailTransport = { ...memory, watch: () => () => undefined };
		const client = createMailClient({ transport });
		await until(client, (s) => s.conversations.length > 0);
		await memory.update({
			o1: { keywords: { $flagged: true } },
			r1: { keywords: { $seen: true } },
		});
		await client.refresh();
		const rows = client.getState().conversations;
		expect(rows.find((c) => c.id === 'o1')?.flagged).toBe(true);
		expect(rows.find((c) => c.id === 'r1')?.unread).toBe(1);
		client.destroy();
	});

	it('connects again on refresh when the first connection failed, one attempt at a time', async () => {
		const memory = createMemoryTransport({ messages: seed(), now: () => T0 + 3_600_000 });
		let offline = true;
		let attempts = 0;
		const transport: MailTransport = {
			...memory,
			async connect() {
				attempts++;
				if (offline) throw new MailTransportError('network', 'Offline.');
				return memory.connect();
			},
		};
		const client = createMailClient({ transport });
		await until(client, (s) => s.status === 'error');
		expect(client.getState()).toMatchObject({ error: 'network', account: null, canSend: false });
		offline = false;
		await Promise.all([client.refresh(), client.refresh()]);
		expect(attempts).toBe(2);
		expect(client.getState()).toMatchObject({
			status: 'ready',
			error: null,
			account: { name: 'you@example.com' },
			canSend: true,
			mailboxId: 'inbox',
		});
		expect(client.getState().conversations).toHaveLength(2);
		// The change feed is on: new mail shows without another refresh.
		memory.deliver({
			mailboxId: 'inbox',
			from: ada,
			to: [me],
			subject: 'Back online',
			receivedAt: T0 + 7_200_000,
		});
		await until(client, (s) => s.conversations.length === 3);
		// Connected now: a refresh reloads what it shows, it does not connect again.
		await client.refresh();
		expect(attempts).toBe(2);
		client.destroy();
	});

	it('flags optimistically and archives with an undo', async () => {
		const { client, transport, notices } = setup();
		await until(client, (s) => s.conversations.length > 0);
		const flagging = client.toggleFlagged(['o1']);
		expect(client.getState().conversations.find((c) => c.id === 'o1')!.flagged).toBe(true);
		await flagging;
		expect((await transport.message('o1')).keywords.$flagged).toBe(true);
		await client.archive(['r1']);
		expect(client.getState().conversations.map((c) => c.id)).toEqual(['o1']);
		expect((await transport.message('r2')).mailboxIds).toEqual(['archive']);
		const done = notices.find((n) => n.kind === 'done' && n.action === 'archived');
		expect(done).toMatchObject({ count: 2 });
		await (done as { undo: () => Promise<void> }).undo();
		await until(client, (s) => s.conversations.length === 2);
		expect((await transport.message('r1')).mailboxIds).toEqual(['inbox']);
		client.destroy();
	});

	it('deletes to Trash first, then for good from Trash', async () => {
		const { client, transport } = setup();
		await until(client, (s) => s.conversations.length > 0);
		await client.remove(['o1']);
		expect((await transport.message('o1')).mailboxIds).toEqual(['trash']);
		await client.selectMailbox('trash');
		await until(client, (s) => s.conversations.length === 1);
		await client.remove(['o1']);
		await expect(transport.message('o1')).rejects.toMatchObject({ code: 'notFound' });
		client.destroy();
	});

	it('replies, sends and marks the original answered', async () => {
		const { client, transport, notices } = setup();
		await until(client, (s) => s.conversations.length > 0);
		await client.compose('reply', 'r2');
		const draft = client.getState().compose!.draft;
		expect(draft.to).toEqual([ada]);
		expect(draft.subject).toBe('Re: Plan');
		expect(draft.inReplyTo).toEqual(['r2@x']);
		client.updateDraft({ text: `Sounds good.${draft.text}` });
		expect(await client.send()).toBe(true);
		expect(client.getState().compose).toBeNull();
		expect(notices.some((n) => n.kind === 'done' && n.action === 'sent')).toBe(true);
		const sent = await transport.query({ mailboxId: 'sent' });
		expect(sent.total).toBe(1);
		expect((await transport.message('r2')).keywords.$answered).toBe(true);
		client.destroy();
	});

	it('refuses to send without a valid recipient', async () => {
		const { client } = setup();
		await until(client, (s) => s.status === 'ready');
		await client.compose('new');
		client.updateDraft({ to: [{ name: '', email: 'not an address' }], subject: 'x' });
		expect(await client.send()).toBe(false);
		expect(client.getState().compose).toMatchObject({ status: 'error', error: 'invalid' });
		client.destroy();
	});

	it('saves a draft after a quiet moment, never two saves at once', async () => {
		const { client, transport, pending } = setup({ timers: true });
		await until(client, (s) => s.status === 'ready');
		await client.compose('new');
		client.updateDraft({ subject: 'One' });
		client.updateDraft({ subject: 'Two' });
		const saves = vi.spyOn(transport, 'saveDraft');
		pending.at(-1)!();
		client.updateDraft({ subject: 'Three' });
		await client.saveDraft();
		await until(client, (s) => s.compose?.status === 'saved');
		const drafts = await transport.query({ mailboxId: 'drafts' });
		expect(drafts.total).toBe(1);
		expect((await transport.summaries(drafts.ids))[0]!.subject).toBe('Three');
		expect(saves.mock.calls.length).toBeLessThanOrEqual(3);
		saves.mockRestore();
		await client.discardDraft();
		expect((await transport.query({ mailboxId: 'drafts' })).total).toBe(0);
		client.destroy();
	});

	it('searches the open folder or every folder', async () => {
		const { client } = setup();
		await until(client, (s) => s.conversations.length > 0);
		await client.search('from:ben');
		expect(client.getState().conversations.map((c) => c.subject)).toEqual(['Lunch']);
		await client.search('');
		expect(client.getState().conversations).toHaveLength(2);
		client.destroy();
	});

	it('picks up new mail from the transport', async () => {
		const { client, transport } = setup();
		await until(client, (s) => s.conversations.length === 2);
		transport.deliver({
			mailboxId: 'inbox',
			from: ada,
			to: [me],
			subject: 'Fresh',
			text: 'Hi',
			receivedAt: T0 + 7_200_000,
		});
		const state = await until(client, (s) => s.conversations.length === 3);
		expect(state.conversations[0]!.subject).toBe('Fresh');
		client.destroy();
	});

	it('exports and imports a message as .eml', async () => {
		const { client } = setup();
		await until(client, (s) => s.conversations.length > 0);
		const file = await client.exportEml('o1');
		expect(file.name).toBe('Lunch.eml');
		expect(new TextDecoder().decode(file.bytes)).toContain('Subject: Lunch');
		await client.importEml([file], 'archive');
		await client.selectMailbox('archive');
		const state = await until(client, (s) => s.conversations.length === 1);
		expect(state.conversations[0]!.subject).toBe('Lunch');
		client.destroy();
	});

	it('says so when a message cannot be exported, as a download that fails does', async () => {
		const memory = createMemoryTransport({ messages: seed(), now: () => T0 + 3_600_000 });
		const transport: MailTransport = {
			...memory,
			download: async () => {
				throw new MailTransportError('network', 'Offline.');
			},
		};
		const client = createMailClient({ transport });
		const notices: MailNotice[] = [];
		client.onNotice((notice) => notices.push(notice));
		await until(client, (s) => s.conversations.length > 0);
		await expect(client.exportEml('o1')).rejects.toMatchObject({ code: 'network' });
		expect(notices).toEqual([{ kind: 'error', action: 'download', code: 'network' }]);
		client.destroy();
	});

	it('keeps contacts and imports vCards', async () => {
		const { client, notices } = setup();
		await until(client, (s) => s.status === 'ready');
		const count = await client.importVCards(
			'BEGIN:VCARD\nFN:Grace\nEMAIL:grace@example.com\nEND:VCARD\nbroken',
		);
		expect(count).toBe(1);
		expect(client.getState().contacts.map((c) => c.name)).toEqual(['Grace']);
		expect(notices.some((n) => n.kind === 'warning' && n.action === 'contactsImported')).toBe(true);
		expect(client.exportVCards()).toContain('FN:Grace');
		client.destroy();
	});
});
