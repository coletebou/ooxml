import { createMailClient } from './client';
import type { MailNotice } from './client-types';
import { createMemoryTransport, type MemoryTransport } from './memory-transport';
import { DEFAULT_MAILBOXES, type SeedMailbox } from './memory-messages';
import { until } from './test-support/client';

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);
const ada = { name: 'Ada', email: 'ada@example.com' };
const me = { name: 'You', email: 'you@example.com' };

function server(mailboxes: readonly SeedMailbox[]): MemoryTransport {
	return createMemoryTransport({
		mailboxes,
		now: () => T0,
		messages: ['a', 'b'].map((id, minute) => ({
			id,
			mailboxId: 'inbox',
			from: ada,
			to: [me],
			subject: `Subject ${id}`,
			text: 'Hello',
			receivedAt: T0 + minute * 60_000,
		})),
	});
}

/** A client of `transport` that lists each message on its own; the change feed never runs. */
async function connect(transport: MemoryTransport) {
	const notices: MailNotice[] = [];
	const client = createMailClient({
		transport,
		threaded: false,
		setTimeout: () => 0,
		clearTimeout: () => undefined,
	});
	client.onNotice((notice) => notices.push(notice));
	await until(client, (s) => s.status === 'ready' && s.conversations.length === 2);
	return { client, notices };
}

const undoOf = (notices: readonly MailNotice[]): (() => Promise<void>) => {
	const done = notices.find((notice) => notice.kind === 'done' && notice.undo);
	if (done?.kind !== 'done' || !done.undo) throw new Error('no notice with an undo');
	return done.undo;
};

describe('moving and deleting', () => {
	it('refuses to delete without a Trash folder rather than destroying the mail', async () => {
		const transport = server(DEFAULT_MAILBOXES.filter((mailbox) => mailbox.role !== 'trash'));
		const { client, notices } = await connect(transport);
		await client.remove(['a']);
		expect(notices).toEqual([{ kind: 'error', action: 'delete', code: 'unsupported' }]);
		expect((await transport.message('a')).mailboxIds).toEqual(['inbox']);
		expect(client.getState().conversations.map((c) => c.id)).toEqual(['b', 'a']);
		client.destroy();
	});

	it('puts a message back in every folder it was in when a move is undone', async () => {
		const transport = server([...DEFAULT_MAILBOXES, { id: 'projects', name: 'Projects' }]);
		await transport.update({ a: { mailboxIds: { projects: true } } });
		const { client, notices } = await connect(transport);
		await client.moveTo('projects', ['a']);
		expect((await transport.message('a')).mailboxIds).toEqual(['projects']);
		expect(client.getState().conversations.map((c) => c.id)).toEqual(['b']);
		await undoOf(notices)();
		expect([...(await transport.message('a')).mailboxIds].sort()).toEqual(['inbox', 'projects']);
		expect(client.getState().conversations.map((c) => c.id)).toEqual(['b', 'a']);
		// The client knows where the message is again, so the same move works at once.
		await client.moveTo('projects', ['a']);
		expect((await transport.message('a')).mailboxIds).toEqual(['projects']);
		client.destroy();
	});

	it('keeps the moves the server made when it refuses some, and undoes those', async () => {
		const transport = server(DEFAULT_MAILBOXES);
		const { client, notices } = await connect(transport);
		// Deleted elsewhere meanwhile: the server archives `b` and refuses `a`.
		await transport.destroy(['a']);
		await client.archive(['a', 'b']);
		expect((await transport.message('b')).mailboxIds).toEqual(['archive']);
		expect(client.getState().conversations.map((c) => c.id)).toEqual(['a']);
		expect(notices).toMatchObject([
			{ kind: 'error', action: 'move', code: 'notFound' },
			{ kind: 'done', action: 'archived', count: 1 },
		]);
		await undoOf(notices)();
		expect((await transport.message('b')).mailboxIds).toEqual(['inbox']);
		expect(client.getState().conversations.map((c) => c.id)).toEqual(['b']);
		client.destroy();
	});

	it('takes a message out of Trash that is filed elsewhere too, without destroying it', async () => {
		const transport = server([...DEFAULT_MAILBOXES, { id: 'projects', name: 'Projects' }]);
		await transport.update({ a: { mailboxIds: { projects: true } } });
		const { client, notices } = await connect(transport);
		await client.remove(['a']);
		expect([...(await transport.message('a')).mailboxIds].sort()).toEqual(['projects', 'trash']);
		await client.selectMailbox('trash');
		expect(client.getState().conversations.map((c) => c.id)).toEqual(['a']);
		notices.length = 0;
		await client.remove(['a']);
		// It stays in the folder it was never deleted from.
		expect((await transport.message('a')).mailboxIds).toEqual(['projects']);
		expect(client.getState().conversations).toEqual([]);
		expect(notices).toMatchObject([{ kind: 'done', action: 'deleted', count: 1 }]);
		await undoOf(notices)();
		expect([...(await transport.message('a')).mailboxIds].sort()).toEqual(['projects', 'trash']);
		expect(client.getState().conversations.map((c) => c.id)).toEqual(['a']);
		client.destroy();
	});

	it('moves what a search of every folder finds to Trash, never destroying what is there', async () => {
		const transport = server(DEFAULT_MAILBOXES);
		const { client, notices } = await connect(transport);
		await client.remove(['a']);
		await client.setSearchScope('all');
		await client.search('Subject');
		await until(client, (s) => s.conversations.length === 2);
		notices.length = 0;
		await client.remove(['a', 'b']);
		// Only Delete in Trash deletes for good: here the one in Trash already stays there.
		expect((await transport.message('a')).mailboxIds).toEqual(['trash']);
		expect((await transport.message('b')).mailboxIds).toEqual(['trash']);
		expect(notices).toMatchObject([{ kind: 'done', action: 'deleted', count: 1 }]);
		// A search of Trash alone is the Trash view: there it does delete for good.
		await client.setSearchScope('mailbox');
		await client.selectMailbox('trash');
		await client.search('Subject');
		await until(client, (s) => s.conversations.length === 2);
		await client.remove(['a']);
		await expect(transport.message('a')).rejects.toMatchObject({ code: 'notFound' });
		expect((await transport.message('b')).mailboxIds).toEqual(['trash']);
		client.destroy();
	});
});
