import { createMailClient } from './client';
import { createMemoryTransport } from './memory-transport';
import type { SeedMessage } from './memory-messages';
import { until } from './test-support/client';
import type { MailTransport } from './transport';

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);
const ada = { name: 'Ada', email: 'ada@example.com' };
const me = { name: 'You', email: 'you@example.com' };

/** One conversation of `length` messages, each answering the one before. */
function longThread(length: number): SeedMessage[] {
	return Array.from({ length }, (_, i) => ({
		id: `m${i}`,
		mailboxId: 'inbox',
		from: ada,
		to: [me],
		subject: i ? 'Re: Long' : 'Long',
		text: `Message ${i}`,
		messageId: `m${i}@example.com`,
		...(i ? { inReplyTo: [`m${i - 1}@example.com`], references: ['m0@example.com'] } : {}),
		receivedAt: T0 + i * 60_000,
	}));
}

describe('the bodies of the open conversation', () => {
	it('keeps every body of a conversation longer than the body cache while it is open', async () => {
		const memory = createMemoryTransport({ messages: longThread(205), now: () => T0 });
		let reads = 0;
		const transport: MailTransport = {
			...memory,
			message: (id, options) => {
				reads++;
				return memory.message(id, options);
			},
		};
		const client = createMailClient({
			transport,
			setTimeout: () => 0,
			clearTimeout: () => undefined,
		});
		await until(client, (s) => s.status === 'ready' && s.conversations.length === 1);
		const [conversation] = client.getState().conversations;
		await client.open(conversation!.id);
		const missing = () =>
			client
				.getState()
				.open!.messages.filter((entry) => !entry.message)
				.map((entry) => entry.summary.id);
		expect(missing()).toEqual([]);
		expect(reads).toBe(205);
		// Opened again, it shows them all from the cache, reading nothing again.
		client.close();
		await client.open(conversation!.id);
		expect(missing()).toEqual([]);
		expect(reads).toBe(205);
		client.destroy();
	});

	it('keeps the open view as it is while nothing it shows changes', async () => {
		const client = createMailClient({
			transport: createMemoryTransport({ messages: longThread(2), now: () => T0 }),
			threaded: false,
			setTimeout: () => 0,
			clearTimeout: () => undefined,
		});
		await until(client, (s) => s.status === 'ready' && s.conversations.length === 2);
		await client.open('m1');
		const view = client.getState().open;
		expect(view?.messages[0]?.message?.text).toBe('Message 1');
		// A message of another conversation flagged: the reading pane has nothing new to show.
		await client.toggleFlagged(['m0']);
		expect(client.getState().open).toBe(view);
		// One of its own: a new view, showing the flag.
		await client.toggleFlagged(['m1']);
		expect(client.getState().open).not.toBe(view);
		expect(client.getState().open?.messages[0]?.summary.keywords.$flagged).toBe(true);
		client.destroy();
	});
});
