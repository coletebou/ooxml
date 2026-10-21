import { createMailClient } from './client';
import type { MailNotice } from './client-types';
import { createMemoryTransport } from './memory-transport';
import { until } from './test-support/client';
import { MailTransportError, type MailQueryPage, type MailTransport } from './transport';

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);

/**
 * A memory server holding `count` messages in the Inbox, newest first, that answers a query with
 * `cap` ids at most, as a JMAP server may (RFC 8620 5.5); with `stuck`, it starts every answer at
 * the first match, wherever it is asked to.
 */
function capped(count: number, cap: number, stuck = false) {
	const memory = createMemoryTransport({
		now: () => T0,
		messages: Array.from({ length: count }, (_, i) => ({
			id: `m${i}`,
			mailboxId: 'inbox',
			from: { name: 'Ada', email: 'ada@example.com' },
			subject: `Message ${i}`,
			receivedAt: T0 - i * 60_000,
		})),
	});
	const asked: MailQueryPage[] = [];
	const transport: MailTransport = {
		...memory,
		async query(query, page = {}) {
			asked.push(page);
			const position = stuck ? 0 : page.position;
			const limit = Math.min(page.limit ?? cap, cap);
			return memory.query(query, { ...(position === undefined ? {} : { position }), limit });
		},
	};
	const client = createMailClient({
		transport,
		threaded: false,
		listLimit: 3,
		setTimeout: () => 0,
		clearTimeout: () => undefined,
	});
	const ids = () => client.getState().conversations.map((conversation) => conversation.id);
	return { client, asked, ids };
}

describe('the message list', () => {
	it('loads more than the server sends in one answer, page after page', async () => {
		const { client, asked, ids } = capped(7, 2);
		await until(client, (s) => s.status === 'ready');
		expect(ids()).toEqual(['m0', 'm1', 'm2']);
		expect(client.getState()).toMatchObject({ loaded: 3, total: 7 });
		// Each page starts where the last one ended, and asks only for what is still missing.
		expect(asked).toEqual([
			{ position: 0, limit: 3 },
			{ position: 2, limit: 1 },
		]);
		await client.loadMore();
		expect(ids()).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5']);
		await client.loadMore();
		expect(client.getState()).toMatchObject({ loaded: 7, total: 7 });
		client.destroy();
	});

	it('stops at what it has when a page brings nothing new', async () => {
		const { client, ids } = capped(7, 2, true);
		await until(client, (s) => s.status === 'ready');
		// Asked again from where it ended, it would get the same first page for ever.
		expect(ids()).toEqual(['m0', 'm1']);
		expect(client.getState()).toMatchObject({ loaded: 2, total: 7 });
		client.destroy();
	});
});

describe('changes to messages the list holds', () => {
	it('fetches a changed message on a later load when fetching it at the change failed', async () => {
		const memory = createMemoryTransport({
			now: () => T0,
			messages: ['m0', 'm1'].map((id, i) => ({
				id,
				mailboxId: 'inbox',
				from: { name: 'Ada', email: 'ada@example.com' },
				subject: `Message ${i}`,
				receivedAt: T0 - i * 60_000,
			})),
		});
		let offline = false;
		const transport: MailTransport = {
			...memory,
			async summaries(ids) {
				if (offline) throw new MailTransportError('network', 'The server cannot be reached.');
				return memory.summaries(ids);
			},
		};
		const client = createMailClient({ transport, threaded: false });
		const notices: MailNotice[] = [];
		client.onNotice((notice) => notices.push(notice));
		await until(client, (s) => s.status === 'ready');
		const listed = () => client.getState().conversations.map((c) => [c.id, c.flagged]);
		// Flagged elsewhere while its summary cannot be fetched: the change feed moves past it, and
		// the list keeps what it shows.
		offline = true;
		await memory.update({ m1: { keywords: { $flagged: true } } });
		await vi.waitFor(() =>
			expect(notices).toContainEqual(expect.objectContaining({ kind: 'error' })),
		);
		expect(listed()).toEqual([
			['m0', false],
			['m1', false],
		]);
		// Once it can be fetched, the next change brings it too, though only another message changed.
		offline = false;
		await memory.update({ m0: { keywords: { $seen: true } } });
		await vi.waitFor(() =>
			expect(listed()).toEqual([
				['m0', false],
				['m1', true],
			]),
		);
		client.destroy();
	});
});
