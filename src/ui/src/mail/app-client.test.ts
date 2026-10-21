import {
	createDemoSeed,
	createMailClient,
	createMemoryTransport,
	MailTransportError,
	type Draft,
	type MailClient,
	type MailTransport,
} from 'ooxml-core/mail';
import { release } from './app-client';

/**
 * The demo mailbox through a transport whose first `failures` saves fail, as when offline, until
 * `recover()` brings it back.
 */
function flakyTransport(failures: number) {
	const base = createMemoryTransport(createDemoSeed({ now: Date.UTC(2026, 9, 20) }));
	const saved: Draft[] = [];
	let saves = 0;
	let failing = failures;
	let closed = false;
	const transport: MailTransport = {
		...base,
		async saveDraft(draft) {
			if (++saves <= failing) throw new MailTransportError('network', 'Offline.');
			saved.push(draft);
			return base.saveDraft(draft);
		},
		close() {
			closed = true;
			base.close();
		},
	};
	return {
		transport,
		saved,
		saves: () => saves,
		closed: () => closed,
		recover: () => (failing = 0),
	};
}

/** A connected client whose open draft has edits the server does not hold yet. */
async function editing(transport: MailTransport): Promise<MailClient> {
	const client = createMailClient({ transport });
	await vi.waitFor(() => expect(client.getState().status).toBe('ready'));
	await client.compose('new');
	client.updateDraft({ subject: 'Unsent thoughts' });
	return client;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('release', () => {
	it('lets a client go once its open draft is saved', async () => {
		const { transport, saved, closed } = flakyTransport(0);
		await release(await editing(transport));
		expect(saved.map((draft) => draft.subject)).toEqual(['Unsent thoughts']);
		expect(closed()).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('keeps trying to save a draft it could not save, then lets the client go', async () => {
		const { transport, saved, saves, closed } = flakyTransport(2);
		const released = release(await editing(transport));
		await vi.advanceTimersByTimeAsync(0);
		expect([saves(), closed()]).toEqual([1, false]);
		await vi.advanceTimersByTimeAsync(5_000);
		expect([saves(), closed()]).toEqual([2, false]);
		await vi.advanceTimersByTimeAsync(15_000);
		await released;
		expect(saves()).toBe(3);
		expect(saved.map((draft) => draft.subject)).toEqual(['Unsent thoughts']);
		expect(closed()).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('never lets a client go with its draft unsaved, trying once a minute until it saves', async () => {
		const { transport, saved, saves, closed, recover } = flakyTransport(Infinity);
		let done = false;
		const released = release(await editing(transport)).then(() => (done = true));
		// Four tries in the first minute: at once, then after 5, 15 and 40 seconds.
		await vi.advanceTimersByTimeAsync(60_000);
		expect([saves(), closed(), done]).toEqual([4, false, false]);
		// Ten minutes offline: one more try each minute, and the client stays.
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect([saves(), closed(), done]).toEqual([14, false, false]);
		expect(saved).toEqual([]);
		recover();
		await vi.advanceTimersByTimeAsync(60_000);
		await released;
		expect(saves()).toBe(15);
		expect(saved.map((draft) => draft.subject)).toEqual(['Unsent thoughts']);
		expect(closed()).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});
});
