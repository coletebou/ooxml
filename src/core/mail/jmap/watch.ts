// What runs while someone watches: push when the session has an event source (with polling while
// push fails), polling every `pollIntervalMs`, or with `off` only the states of the responses the
// client asks for anyway. Every path ends in the change tracker's sync. New code.
import { TRACKED, type ChangeTracker } from './changes';
import type { JmapClient } from './client';
import { startPush, type Timers } from './push';

/** `auto`: push when the session offers it, else polling; `poll`; `off`. */
export type PushMode = 'auto' | 'poll' | 'off';

export interface WatcherOptions {
	client: JmapClient;
	tracker: ChangeTracker;
	timers: Timers;
	mode: PushMode;
	pollIntervalMs: number;
}

export interface Watcher {
	start(): void;
	stop(): void;
}

export function createWatcher(options: WatcherOptions): Watcher {
	const { client, tracker, timers } = options;
	let push: { stop(): void } | null = null;
	let polling = 0;
	let generation = 0;
	let pollTimer: unknown = null;

	const stopPolling = (): void => {
		polling = 0;
		if (pollTimer !== null) timers.clearTimeout(pollTimer);
		pollTimer = null;
	};

	const startPolling = (): void => {
		if (polling) return;
		const mine = ++generation;
		polling = mine;
		const tick = async (): Promise<void> => {
			pollTimer = null;
			await tracker.sync();
			if (polling === mine)
				pollTimer = timers.setTimeout(() => void tick(), options.pollIntervalMs);
		};
		void tracker.sync();
		pollTimer = timers.setTimeout(() => void tick(), options.pollIntervalMs);
	};

	return {
		start() {
			tracker.setActive(true);
			if (options.mode === 'off') return;
			if (options.mode === 'poll') return startPolling();
			push = startPush({
				http: client.http,
				timers,
				template: async () => (await client.session()).eventSourceUrl,
				accountId: () => client.accountId(),
				onState: (states) => {
					const behind = TRACKED.filter(
						(type) => states[type] !== undefined && states[type] !== tracker.state(type),
					);
					if (behind.length) void tracker.sync(behind);
				},
				onOpen: () => void tracker.sync(),
				onFailing: (failing) => (failing ? startPolling() : stopPolling()),
			});
		},
		stop() {
			tracker.setActive(false);
			push?.stop();
			push = null;
			stopPolling();
		},
	};
}
