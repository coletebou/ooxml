// An in-memory BroadcastChannel for tests: channels with the same name in one hub hear each other
// (asynchronously, as browsers deliver), and nothing reaches Node's real BroadcastChannel, so test
// files that share a worker never hear each other.
import type {
	BroadcastChannelConstructor,
	BroadcastChannelLike,
} from '../../collab/broadcast-transport';

export function createChannelHub(): BroadcastChannelConstructor & { open: () => number } {
	const rooms = new Map<string, Set<HubChannel>>();
	class HubChannel implements BroadcastChannelLike {
		onmessage: ((event: { data: unknown }) => void) | null = null;
		private closed = false;
		constructor(readonly name: string) {
			const room = rooms.get(name) ?? new Set();
			room.add(this);
			rooms.set(name, room);
		}
		postMessage(message: unknown): void {
			if (this.closed) return;
			const data = structuredClone(message);
			for (const other of rooms.get(this.name) ?? [])
				if (other !== this) queueMicrotask(() => other.closed || other.onmessage?.({ data }));
		}
		close(): void {
			this.closed = true;
			rooms.get(this.name)?.delete(this);
		}
	}
	return Object.assign(HubChannel, {
		open: () => [...rooms.values()].reduce((n, r) => n + r.size, 0),
	});
}

/** Let queued microtasks and timers of `ms` run. */
export const settle = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
