// Moving messages over JMAP, from the client down to the server: a move the server makes for some
// of the messages only, since a `/set` changes each record on its own (RFC 8620 5.3).
import { createMailClient } from '../client';
import type { MailNotice } from '../client-types';
import { until } from './test-support/fake-server';
import { installMailStore } from './test-support/mail-store';
import { setup } from './test-support/setup';

/** A client listing the Inbox of the fake mail store, which holds `original` and `second`. */
async function connected() {
	const { server, transport } = setup();
	const store = installMailStore(server);
	store.emails.set('second', { mailboxIds: { MBinbox: true }, keywords: { $seen: true } });
	// A folder lists what the store holds in it now.
	server.on('Email/query', (args) => {
		const { inMailbox } = args.filter as { inMailbox: string };
		const ids = [...store.emails].filter(([, email]) => email.mailboxIds[inMailbox]);
		return { ids: ids.map(([id]) => id), position: 0, total: ids.length };
	});
	const notices: MailNotice[] = [];
	// The change feed never runs: what the list shows is what the moves did to it.
	const client = createMailClient({
		transport,
		threaded: false,
		setTimeout: () => 0,
		clearTimeout: () => undefined,
	});
	client.onNotice((notice) => notices.push(notice));
	const listed = () => client.getState().conversations.map((conversation) => conversation.id);
	await until(() => listed().length === 2);
	return { client, store, notices, listed };
}

describe('moving messages over JMAP', () => {
	it('keeps the moves the server made when it refuses some, and undoes those', async () => {
		const { client, store, notices, listed } = await connected();
		// Deleted elsewhere meanwhile: the server moves the other one and refuses this one.
		store.emails.delete('second');
		await client.moveTo('MBwork', ['original', 'second']);
		expect(store.emails.get('original')!.mailboxIds).toEqual({ MBwork: true });
		expect(listed()).toEqual(['second']);
		expect(notices).toMatchObject([
			{ kind: 'error', action: 'move', code: 'notFound' },
			{ kind: 'done', action: 'moved', count: 1, target: 'Work' },
		]);
		const moved = notices[1];
		if (moved?.kind !== 'done' || !moved.undo) throw new Error('no notice with an undo');
		await moved.undo();
		expect(store.emails.get('original')!.mailboxIds).toEqual({ MBinbox: true });
		expect(listed()).toEqual(['original']);
		expect(notices.at(-1)).toEqual({ kind: 'done', action: 'undone', count: 1 });
		client.destroy();
	});

	it('keeps a flag the server set when it refuses it for another message', async () => {
		const { client, store, notices } = await connected();
		store.emails.delete('second');
		await client.setFlagged(true, ['original', 'second']);
		expect(store.emails.get('original')!.keywords).toEqual({ $seen: true, $flagged: true });
		const flagged = (id: string) =>
			client.getState().conversations.find((conversation) => conversation.id === id)?.flagged;
		expect([flagged('original'), flagged('second')]).toEqual([true, false]);
		expect(notices).toEqual([{ kind: 'error', action: 'update', code: 'notFound' }]);
		client.destroy();
	});
});
