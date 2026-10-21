// The JMAP client under the transport: the session (discovered on first use, refetched when a
// response's `sessionState` says it changed), requests that declare the capabilities they use,
// batching by the server's limits, and no more requests or uploads in flight at once than the
// session says the server takes (RFC 8620 2). New code.
import {
	createJmapGate,
	createJmapHttp,
	sessionResourceUrl,
	type JmapAuth,
	type JmapGate,
	type JmapHttp,
} from './http';
import { JmapRequestBuilder, JmapResult, parseJmapResponse, type JmapCall } from './request';
import { loadJmapSession, mailAccountId, type JmapLimits, type JmapSession } from './session';
import { CORE, MAIL, SUBMISSION, type JmapResponse } from './types';

export interface JmapClientOptions {
	url: string;
	auth: JmapAuth;
	fetch?: typeof fetch;
	accountId?: string;
	/** Aborts everything in flight (the transport's lifetime). */
	signal?: AbortSignal;
	/** Sees every response before its caller does (the change tracker reads write states). */
	onResponse?: (response: JmapResponse) => void;
}

/** Failed session refetches for one state before that state is left alone. */
const MAX_REFRESH_TRIES = 3;

export interface JmapClient {
	readonly http: JmapHttp;
	/** Slots for uploads, as many as the session's `maxConcurrentUpload`. */
	readonly uploads: JmapGate;
	/** The session, discovered on first use. */
	session(signal?: AbortSignal): Promise<JmapSession>;
	/** Discovers the session again from the configured URL. */
	connect(signal?: AbortSignal): Promise<JmapSession>;
	/** The account every call uses (valid once the session is loaded). */
	accountId(): string;
	/**
	 * Runs one request; `build` adds its calls and returns the handles to read them by. It waits
	 * while as many requests as the session's `maxConcurrentRequests` are in flight.
	 */
	request<T>(
		build: (builder: JmapRequestBuilder, accountId: string) => T,
		signal?: AbortSignal,
	): Promise<{ result: JmapResult; calls: T }>;
	/**
	 * One call per chunk of `items` (`size` items each), packed `maxCallsInRequest` calls to a
	 * request, the requests one after another.
	 */
	batch<T>(
		items: readonly T[],
		size: (limits: JmapLimits) => number,
		add: (builder: JmapRequestBuilder, accountId: string, chunk: readonly T[]) => JmapCall,
		read: (result: JmapResult, call: JmapCall, chunk: readonly T[]) => void,
	): Promise<void>;
}

/** Splits `items` into lists of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let index = 0; index < items.length; index += size)
		out.push(items.slice(index, index + size));
	return out;
}

const using = (session: JmapSession): string[] => [
	CORE,
	MAIL,
	...(Object.hasOwn(session.capabilities, SUBMISSION) ? [SUBMISSION] : []),
];

export function createJmapClient(options: JmapClientOptions): JmapClient {
	const http = createJmapHttp({
		auth: options.auth,
		...(options.fetch ? { fetch: options.fetch } : {}),
		...(options.signal ? { signal: options.signal } : {}),
	});
	let session: JmapSession | null = null;
	let accountId = '';
	let loading: Promise<JmapSession> | null = null;
	let refreshing: Promise<void> | null = null;
	/** The state a refetch was done for: responses naming it ask for no other. */
	let refreshedFor = '';
	/** The state the last refetch failed for, and how often in a row. */
	let failedFor = '';
	let failures = 0;
	// Each request to the API, and each upload, waits for a slot of its gate; a slot is only asked
	// for once the session, whose limits size the gates, is loaded.
	const requests = createJmapGate(() => session?.limits.maxConcurrentRequests ?? 1);
	const uploads = createJmapGate(() => session?.limits.maxConcurrentUpload ?? 1);

	const discover = (signal?: AbortSignal): Promise<JmapSession> => {
		const attempt = (async () => {
			const next = await loadJmapSession(http, sessionResourceUrl(options.url), signal);
			const account = mailAccountId(next, options.accountId);
			session = next;
			accountId = account;
			return next;
		})();
		loading = attempt;
		const settle = (): void => {
			if (loading === attempt) loading = null;
		};
		attempt.then(settle, settle);
		return attempt;
	};

	const ensure = (signal?: AbortSignal): Promise<JmapSession> =>
		session ? Promise.resolve(session) : (loading ?? discover(signal));

	// A changed `sessionState` means accounts, capabilities or URLs may have changed (RFC 8620 2).
	// The next request waits for the refetch, one at a time. A failed refetch keeps the session it
	// had and is tried again by the next response naming that state, `MAX_REFRESH_TRIES` times at
	// most, so a session resource that keeps failing is not asked on every response.
	const refresh = (state: string): void => {
		if (refreshing || !session || state === refreshedFor) return;
		refreshing = loadJmapSession(http, session.url)
			.then((next) => {
				refreshedFor = state;
				if (Object.hasOwn(next.accounts, accountId)) session = next;
			})
			.catch(() => {
				failures = failedFor === state ? failures + 1 : 1;
				failedFor = state;
				if (failures >= MAX_REFRESH_TRIES) refreshedFor = state;
			})
			.finally(() => {
				refreshing = null;
			});
	};

	const client: JmapClient = {
		http,
		uploads,
		session: ensure,
		connect: discover,
		accountId: () => accountId,
		async request(build, signal) {
			await ensure(signal);
			if (refreshing) await refreshing;
			const active = session!;
			const builder = new JmapRequestBuilder(using(active));
			const calls = build(builder, accountId);
			const what = 'The JMAP request';
			const response = await http.exchange(
				active.apiUrl,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
					body: JSON.stringify(builder.build()),
					gate: requests,
					...(signal ? { signal } : {}),
				},
				what,
				async (reply) => parseJmapResponse(await http.json(reply, what)),
			);
			options.onResponse?.(response);
			if (response.sessionState && response.sessionState !== active.state)
				refresh(response.sessionState);
			return { result: new JmapResult(response, http.redact), calls };
		},
		async batch(items, size, add, read) {
			if (!items.length) return;
			const { limits } = await ensure();
			const chunks = chunk(items, Math.max(1, size(limits)));
			for (const group of chunk(chunks, Math.max(1, limits.maxCallsInRequest))) {
				const { result, calls } = await client.request((builder, account) =>
					group.map((part) => add(builder, account, part)),
				);
				calls.forEach((call, index) => read(result, call, group[index]!));
			}
		},
	};
	return client;
}
