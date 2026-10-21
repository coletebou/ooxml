import { createMailClient } from './client';
import { createMemoryTransport, type MemoryTransport } from './memory-transport';
import { until } from './test-support/client';

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);
const ada = { name: 'Ada', email: 'ada@example.com' };
const me = { name: 'You', email: 'you@example.com' };

/** A mailbox of one message, recording when it is closed and who still watches it. */
function hostTransport() {
	const memory = createMemoryTransport({
		messages: [
			{ id: 'm1', mailboxId: 'inbox', from: ada, to: [me], subject: 'Plan', receivedAt: T0 },
		],
		now: () => T0,
	});
	let closed = false;
	const watching = new Set<() => void>();
	const transport: MemoryTransport = {
		...memory,
		watch(listener) {
			const stop = memory.watch(listener);
			watching.add(stop);
			return () => {
				watching.delete(stop);
				stop();
			};
		},
		close() {
			closed = true;
			memory.close();
		},
	};
	return { transport, closed: () => closed, watchers: () => watching.size };
}

describe('destroying a mail client', () => {
	it('closes its transport, and stops watching it, unless told the transport is kept', async () => {
		for (const closeTransport of [undefined, true, false]) {
			const { transport, closed, watchers } = hostTransport();
			const client = createMailClient({
				transport,
				...(closeTransport === undefined ? {} : { closeTransport }),
			});
			await until(client, (s) => s.status === 'ready');
			expect(watchers()).toBe(1);
			client.destroy();
			expect([closed(), watchers()], String(closeTransport)).toEqual([closeTransport !== false, 0]);
		}
	});

	it('leaves a transport the host keeps open for the next client, which alone sees its mail', async () => {
		const { transport, closed } = hostTransport();
		const first = createMailClient({ transport, closeTransport: false });
		await until(first, (s) => s.status === 'ready');
		const left = first.getState();
		first.destroy();
		expect(closed()).toBe(false);
		const next = createMailClient({ transport, closeTransport: false });
		await until(next, (s) => s.status === 'ready' && s.conversations.length === 1);
		transport.deliver({
			mailboxId: 'inbox',
			from: ada,
			to: [me],
			subject: 'Later',
			receivedAt: T0 + 60_000,
		});
		await until(next, (s) => s.conversations.length === 2);
		// What the server sends once a client is destroyed no longer reaches that client.
		expect(first.getState()).toBe(left);
		expect(await next.compose('new')).toBe(true);
		next.updateDraft({ to: [ada], subject: 'Still open' });
		expect(await next.send()).toBe(true);
		expect((await transport.query({ mailboxId: 'sent' })).total).toBe(1);
		next.destroy();
	});

	it('saves nothing once destroyed, not even a change still waiting for its save', async () => {
		// The host's transport stays open, so a save timed before `destroy` would still go out.
		const { transport } = hostTransport();
		const saveDraft = vi.spyOn(transport, 'saveDraft');
		const timers: (() => void)[] = [];
		const client = createMailClient({
			transport,
			closeTransport: false,
			setTimeout: (callback: () => void) => timers.push(callback),
			clearTimeout: () => {},
		});
		await until(client, (s) => s.status === 'ready');
		expect(await client.compose('new')).toBe(true);
		saveDraft.mockClear();
		client.updateDraft({ to: [ada], subject: 'Typed just before' });
		client.destroy();
		for (const run of timers.splice(0)) run();
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(saveDraft).not.toHaveBeenCalled();
	});
});
