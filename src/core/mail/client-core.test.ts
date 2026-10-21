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
});
