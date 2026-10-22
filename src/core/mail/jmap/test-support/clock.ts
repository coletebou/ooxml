// A fake clock for the push and polling tests: `setTimeout` and `clearTimeout` to inject, and
// `advance` to run what falls due, letting promises settle between timers. Global timers are never
// replaced.
import { flush } from './fake-server';

export interface FakeClock {
	setTimeout: typeof setTimeout;
	clearTimeout: typeof clearTimeout;
	now(): number;
	/** Delays (from now) of the timers waiting, soonest first. */
	waiting(): number[];
	advance(ms: number): Promise<void>;
}

export function createClock(): FakeClock {
	let now = 0;
	let next = 1;
	const timers = new Map<number, { at: number; callback: () => void }>();
	const setTimer = (callback: () => void, ms?: number): number => {
		const id = next++;
		timers.set(id, { at: now + Math.max(0, ms ?? 0), callback });
		return id;
	};
	const clearTimer = (id: unknown): void => {
		timers.delete(id as number);
	};
	return {
		setTimeout: setTimer as unknown as typeof setTimeout,
		clearTimeout: clearTimer as unknown as typeof clearTimeout,
		now: () => now,
		waiting: () => [...timers.values()].map((timer) => timer.at - now).sort((a, b) => a - b),
		async advance(ms) {
			const target = now + ms;
			await flush();
			for (;;) {
				const due = [...timers.entries()]
					.filter(([, timer]) => timer.at <= target)
					.sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
				if (!due) break;
				timers.delete(due[0]);
				now = due[1].at;
				due[1].callback();
				await flush();
			}
			now = target;
			await flush();
		},
	};
}
