// Push over the session's event source (RFC 8620 7.3), read through `fetch` so the `Authorization`
// header goes with it (the platform `EventSource` cannot send one). `state` events for the account
// are handed on; a stream that ends is reopened with capped exponential backoff, one that falls
// silent (no ping for twice the interval) is dropped and reopened, and after repeated failures the
// caller is told to poll until a stream works again. New code.
import { discard, type JmapHttp } from './http';
import { expandTemplate } from './urls';
import { createSseParser, type SseEvent } from './sse';
import { isRecord } from './types';

/** `setTimeout` and `clearTimeout`, injectable for tests. */
export interface Timers {
	setTimeout(callback: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
}

/** The ping interval asked for, in seconds (RFC 8620 7.3 `ping`). */
export const PING_SECONDS = 60;
/** First reconnection delay; it doubles per failure up to `MAX_RETRY_MS`. */
export const RETRY_MS = 1_000;
export const MAX_RETRY_MS = 60_000;
/** Failed connections in a row before the caller should poll. */
export const FAILURES_BEFORE_POLLING = 3;

/** The event source URL: every type, the stream kept open, a ping every `PING_SECONDS`. */
export function eventSourceUrl(template: string): string {
	return expandTemplate(template, { types: '*', closeafter: 'no', ping: String(PING_SECONDS) });
}

export interface PushOptions {
	http: JmapHttp;
	timers: Timers;
	/** The event source template of the current session, `null` when it has none. */
	template(): Promise<string | null>;
	accountId(): string;
	/** The new state strings of a StateChange for this account, by type name. */
	onState(states: Readonly<Record<string, string>>): void;
	/** A stream opened: catch up on whatever happened while there was none. */
	onOpen(): void;
	/** Push is failing (poll) or working again (stop polling). */
	onFailing(failing: boolean): void;
}

/** How a connection went: no event source, refused for good, failed, or opened and ended. */
type Outcome = 'none' | 'refused' | 'failed' | 'opened';

const isEventStream = (response: Response): boolean =>
	(response.headers.get('content-type') ?? '').toLowerCase().startsWith('text/event-stream');

/** Refused for good: not an event stream, or a 4xx other than a timeout or a rate limit. */
const refusedForGood = (response: Response): boolean =>
	response.ok ||
	(response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status));

/** The StateChange types and states for `accountId`, or `null` for any other event. */
export function stateChangeFor(data: string, accountId: string): Record<string, string> | null {
	let change: unknown;
	try {
		change = JSON.parse(data);
	} catch {
		return null;
	}
	if (!isRecord(change) || change['@type'] !== 'StateChange' || !isRecord(change.changed))
		return null;
	const mine = change.changed[accountId];
	if (!isRecord(mine)) return null;
	return Object.fromEntries(
		Object.entries(mine).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
	);
}

export function startPush(options: PushOptions): { stop(): void } {
	const { timers } = options;
	let stopped = false;
	let failures = 0;
	let retryMs = RETRY_MS;
	let pingSeconds = PING_SECONDS;
	let lastEventId = '';
	let failing = false;
	let current: AbortController | null = null;
	let reconnect: unknown = null;
	let watchdog: unknown = null;

	const setFailing = (next: boolean): void => {
		if (failing === next) return;
		failing = next;
		options.onFailing(next);
	};

	const disarm = (): void => {
		if (watchdog !== null) timers.clearTimeout(watchdog);
		watchdog = null;
	};

	const arm = (abort: AbortController): void => {
		disarm();
		watchdog = timers.setTimeout(() => abort.abort(), (pingSeconds * 2 + 10) * 1000);
	};

	const handle = (event: SseEvent): void => {
		if (event.lastEventId) lastEventId = event.lastEventId;
		// The first event proves the stream works: the failure count starts over.
		failures = 0;
		setFailing(false);
		if (event.type === 'ping') {
			try {
				const ping: unknown = JSON.parse(event.data);
				if (isRecord(ping) && typeof ping.interval === 'number' && ping.interval > 0)
					pingSeconds = ping.interval;
			} catch {
				// A ping without a readable interval is still a sign of life.
			}
			return;
		}
		if (event.type !== 'state' && event.type !== 'message') return;
		const states = stateChangeFor(event.data, options.accountId());
		if (states) options.onState(states);
	};

	const stream = async (abort: AbortController, heard: () => void): Promise<Outcome> => {
		const template = await options.template();
		if (!template) return 'none';
		if (stopped) return 'failed';
		const response = await options.http.open(
			eventSourceUrl(template),
			{
				method: 'GET',
				headers: {
					Accept: 'text/event-stream',
					...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
				},
				signal: abort.signal,
			},
			'The push connection',
		);
		if (!response.ok || !isEventStream(response) || !response.body) {
			await discard(response);
			return refusedForGood(response) ? 'refused' : 'failed';
		}
		options.onOpen();
		const parser = createSseParser({
			event: (event) => {
				heard();
				handle(event);
			},
			retry: (ms) => {
				retryMs = Math.min(MAX_RETRY_MS, Math.max(RETRY_MS, ms));
			},
		});
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		arm(abort);
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			parser.push(decoder.decode(value, { stream: true }));
			arm(abort);
		}
		parser.push(decoder.decode());
		parser.end();
		return 'opened';
	};

	const schedule = (delay: number): void => {
		reconnect = timers.setTimeout(() => {
			reconnect = null;
			void connect();
		}, delay);
	};

	const connect = async (): Promise<void> => {
		if (stopped) return;
		const abort = new AbortController();
		current = abort;
		let heard = false;
		let outcome: Outcome;
		try {
			outcome = await stream(abort, () => {
				heard = true;
			});
		} catch {
			// A network error, or the watchdog dropping a silent stream.
			outcome = 'failed';
		} finally {
			if (current === abort) current = null;
			disarm();
		}
		if (stopped) return;
		if (outcome === 'none' || outcome === 'refused') return setFailing(true);
		// A stream that delivered events just ended: reopen it soon.
		if (heard) return schedule(retryMs);
		// Failed, or closed before saying anything: back off, so a server that drops every stream
		// at once is not asked again and again.
		failures++;
		if (failures >= FAILURES_BEFORE_POLLING) setFailing(true);
		schedule(Math.min(MAX_RETRY_MS, retryMs * 2 ** (failures - 1)));
	};

	void connect();
	return {
		stop() {
			stopped = true;
			current?.abort();
			current = null;
			disarm();
			if (reconnect !== null) timers.clearTimeout(reconnect);
			reconnect = null;
		},
	};
}
