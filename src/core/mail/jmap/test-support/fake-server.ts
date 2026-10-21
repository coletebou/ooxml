// A fake JMAP server for the transport tests: a `fetch` that serves the session, runs method calls
// (resolving result references as RFC 8620 3.7 says, with `Core/echo` built in), takes uploads,
// serves downloads, holds event source streams open and follows redirects the way a server-side
// or a browser fetch does, recording every request. Nothing touches the network.
import fixture from '../__fixtures__/rfc8620-session.json';
import { SUBMISSION, isRecord, type JmapInvocation, type JmapRequest } from '../types';

export interface Recorded {
	method: string;
	url: string;
	/** Header names in lower case. */
	headers: Record<string, string>;
	body: string | null;
	bytes: Uint8Array | null;
}

export type MethodHandler = (
	args: Record<string, unknown>,
	call: { id: string; name: string },
) => Record<string, unknown> | JmapInvocation[];

export interface FakeStream {
	url: string;
	headers: Record<string, string>;
	send(text: string): void;
	end(): void;
	readonly closed: boolean;
}

/**
 * Whose `fetch` the fake is when an answer is a redirect. `node` (the default) follows every hop,
 * plain http included, and hands a redirect back as it is under `redirect: 'manual'`. `browser`
 * (an https page) refuses plain http to anything but loopback as mixed content and hides a manual
 * redirect behind an `opaqueredirect` response. Both drop `Authorization` on a hop to another
 * origin, as fetch does.
 */
export type FakeRuntime = 'node' | 'browser';

export interface FakeServer {
	fetch: typeof fetch;
	requests: Recorded[];
	session: Record<string, unknown>;
	sessionUrl: string;
	sessionState: string;
	streams: FakeStream[];
	runtime: FakeRuntime;
	on(method: string, handler: MethodHandler): void;
	/** Answers the requests `match` accepts with `respond` (newest route first). */
	route(
		match: (request: Recorded) => boolean,
		respond: (request: Recorded) => Response | Promise<Response>,
	): void;
	/** Answers requests for `from` with a redirect (302 unless `status` says) to `location`. */
	redirect(from: string, location: string, status?: number): void;
	apiRequests(): JmapRequest[];
	/** Every method call posted, in order. */
	calls(): JmapInvocation[];
	/** The arguments of the method calls named `name`, in order. */
	argsOf(name: string): Record<string, unknown>[];
}

/** A copy of the RFC 8620 2.1 session, with submission added unless `submission` is false. */
export function rfcSession(options: { submission?: boolean } = {}): Record<string, unknown> {
	const session = structuredClone(fixture.session) as Record<string, unknown> &
		typeof fixture.session;
	if (options.submission !== false) {
		(session.capabilities as Record<string, unknown>)[SUBMISSION] = {};
		(session.accounts.A13824.accountCapabilities as Record<string, unknown>)[SUBMISSION] = {
			maxDelayedSend: 0,
			submissionExtensions: {},
		};
	}
	return session;
}

export const json = (
	value: unknown,
	status = 200,
	headers: Record<string, string> = {},
): Response =>
	new Response(JSON.stringify(value), {
		status,
		headers: { 'Content-Type': 'application/json', ...headers },
	});

/** `response` as fetch hands it back after following redirects to `url`. */
export function redirectedTo(url: string, response: Response): Response {
	Object.defineProperty(response, 'redirected', { value: true });
	Object.defineProperty(response, 'url', { value: url });
	return response;
}

/** The statuses fetch follows (Fetch, "redirect status"). */
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/** Fetch's own limit on redirects in a row. */
const MAX_REDIRECTS = 20;
/** Fetch's request-body headers, dropped with the body when a redirect turns into a GET. */
const BODY_HEADERS = ['content-encoding', 'content-language', 'content-location', 'content-type'];

/** What a browser on an https page refuses to fetch: plain http to anything but loopback. */
function mixedContent(url: string): boolean {
	const { protocol, hostname } = new URL(url);
	return protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}

/** A browser's answer to `redirect: 'manual'`: no status, no headers, nothing about the target. */
function opaqueRedirect(): Response {
	const response = Response.error();
	Object.defineProperty(response, 'type', { value: 'opaqueredirect' });
	return response;
}

function unescape(token: string): string {
	return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** RFC 8620 3.7: a JSON Pointer where `*` maps an array and flattens array results. */
export function evaluatePointer(value: unknown, tokens: readonly string[]): unknown {
	if (!tokens.length) return value;
	const [token, ...rest] = tokens as [string, ...string[]];
	if (Array.isArray(value)) {
		if (token === '*')
			return value.flatMap((item) => {
				const out = evaluatePointer(item, rest);
				return Array.isArray(out) ? out : [out];
			});
		if (!/^\d+$/.test(token) || Number(token) >= value.length) throw new Error('unresolved');
		return evaluatePointer(value[Number(token)], rest);
	}
	const key = unescape(token);
	if (isRecord(value) && Object.hasOwn(value, key)) return evaluatePointer(value[key], rest);
	throw new Error('unresolved');
}

function resolve(
	args: Record<string, unknown>,
	done: readonly JmapInvocation[],
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(args)) {
		if (!key.startsWith('#')) {
			out[key] = value;
			continue;
		}
		if (!isRecord(value)) throw new Error('unresolved');
		const source = done.find((response) => response[2] === value.resultOf);
		if (!source || source[0] !== value.name || typeof value.path !== 'string')
			throw new Error('unresolved');
		out[key.slice(1)] = evaluatePointer(source[1], value.path.split('/').slice(1));
	}
	return out;
}

/** A pending answer that rejects when `signal` aborts first, as `fetch` does. */
function abortable(
	answer: Response | Promise<Response>,
	signal: AbortSignal | undefined,
): Promise<Response> {
	if (!signal) return Promise.resolve(answer);
	return new Promise((resolve, reject) => {
		const onAbort = (): void => reject(signal.reason);
		signal.addEventListener('abort', onAbort, { once: true });
		Promise.resolve(answer).then((response) => {
			signal.removeEventListener('abort', onAbort);
			resolve(response);
		}, reject);
	});
}

const lower = (headers: HeadersInit | undefined): Record<string, string> => {
	const out: Record<string, string> = {};
	new Headers(headers).forEach((value, name) => {
		out[name] = value;
	});
	return out;
};

export function createFakeServer(
	options: { session?: Record<string, unknown>; sessionUrl?: string } = {},
): FakeServer {
	const handlers = new Map<string, MethodHandler>();
	const routes: {
		match: (request: Recorded) => boolean;
		respond: (request: Recorded) => Response | Promise<Response>;
	}[] = [];
	let blobs = 0;

	const endpoint = (key: string): string => {
		const value = server.session[key];
		return typeof value === 'string' ? new URL(value.split('{')[0]!, server.sessionUrl).href : '\0';
	};

	const api = (request: Recorded): Response => {
		const body = JSON.parse(request.body ?? '{}') as JmapRequest;
		const done: JmapInvocation[] = [];
		for (const [name, args, id] of body.methodCalls) {
			let resolved: Record<string, unknown>;
			try {
				resolved = resolve(args, done);
			} catch {
				done.push(['error', { type: 'invalidResultReference' }, id]);
				continue;
			}
			const handler =
				handlers.get(name) ??
				(name === 'Core/echo' ? (echo: Record<string, unknown>) => echo : undefined);
			if (!handler) {
				done.push(['error', { type: 'unknownMethod' }, id]);
				continue;
			}
			const out = handler(resolved, { id, name });
			if (Array.isArray(out)) done.push(...out);
			else done.push([name, out, id]);
		}
		return json({ methodResponses: done, sessionState: server.sessionState });
	};

	const stream = (request: Recorded, signal: AbortSignal | undefined): Response => {
		let controller!: ReadableStreamDefaultController<Uint8Array>;
		let closed = false;
		const encoder = new TextEncoder();
		const body = new ReadableStream<Uint8Array>({
			start(c) {
				controller = c;
			},
			cancel() {
				closed = true;
			},
		});
		signal?.addEventListener('abort', () => {
			if (closed) return;
			closed = true;
			controller.error(signal.reason);
		});
		server.streams.push({
			url: request.url,
			headers: request.headers,
			send: (text) => {
				if (!closed) controller.enqueue(encoder.encode(text));
			},
			end: () => {
				if (closed) return;
				closed = true;
				controller.close();
			},
			get closed() {
				return closed;
			},
		});
		return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
	};

	/** The server's answer to one request (one hop of a redirect chain). */
	const answer = (
		request: Recorded,
		signal: AbortSignal | undefined,
	): Response | Promise<Response> => {
		const route = routes.find((candidate) => candidate.match(request));
		if (route) return abortable(route.respond(request), signal);
		if (request.method === 'GET' && request.url === server.sessionUrl) return json(server.session);
		if (request.method === 'POST' && request.url === endpoint('apiUrl')) return api(request);
		if (request.method === 'POST' && request.url.startsWith(endpoint('uploadUrl'))) {
			const size = request.bytes?.byteLength ?? 0;
			const type = request.headers['content-type'] ?? '';
			return json({ accountId: 'A13824', blobId: `G${++blobs}`, type, size }, 201);
		}
		if (request.method === 'GET' && request.url.startsWith(endpoint('eventSourceUrl')))
			return stream(request, signal);
		return json({ type: 'about:blank', status: 404, detail: 'Not found' }, 404);
	};

	const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const signal = init?.signal ?? undefined;
		if (signal?.aborted) throw signal.reason;
		const raw = init?.body;
		let request: Recorded = {
			method: init?.method ?? 'GET',
			url: String(input),
			headers: lower(init?.headers),
			body: typeof raw === 'string' ? raw : null,
			bytes: raw instanceof Uint8Array ? raw : null,
		};
		for (let hops = 0; ; hops++) {
			// Blocked before it is sent, so the server never sees it.
			if (server.runtime === 'browser' && mixedContent(request.url))
				throw new TypeError('Failed to fetch: mixed content.');
			server.requests.push(request);
			const response = await answer(request, signal);
			const location = REDIRECTS.has(response.status) ? response.headers.get('location') : null;
			if (location === null) return hops ? redirectedTo(request.url, response) : response;
			if (init?.redirect === 'manual')
				return server.runtime === 'browser' ? opaqueRedirect() : response;
			if (init?.redirect === 'error') throw new TypeError('Failed to fetch: a redirect.');
			if (hops === MAX_REDIRECTS) throw new TypeError('Failed to fetch: too many redirects.');
			const url = new URL(location, request.url).href;
			const headers = { ...request.headers };
			if (new URL(url).origin !== new URL(request.url).origin) delete headers.authorization;
			// A 303, or a 301 or 302 answering a POST, goes on as a GET without the body and the
			// headers about it.
			const get =
				response.status === 303 ||
				(request.method === 'POST' && (response.status === 301 || response.status === 302));
			if (get) for (const name of BODY_HEADERS) delete headers[name];
			request = get
				? { method: 'GET', url, headers, body: null, bytes: null }
				: { ...request, url, headers };
		}
	};

	const server: FakeServer = {
		fetch: fakeFetch as typeof fetch,
		requests: [],
		session: options.session ?? rfcSession(),
		sessionUrl: options.sessionUrl ?? 'https://jmap.example.com/.well-known/jmap',
		sessionState: '75128aab4b1b',
		streams: [],
		runtime: 'node',
		on(method, handler) {
			handlers.set(method, handler);
		},
		route(match, respond) {
			routes.unshift({ match, respond });
		},
		redirect(from, location, status = 302) {
			server.route(
				(request) => request.url === from,
				() => new Response(null, { status, headers: { Location: location } }),
			);
		},
		apiRequests: () =>
			server.requests
				.filter((request) => request.method === 'POST' && request.url === endpoint('apiUrl'))
				.map((request) => JSON.parse(request.body ?? '{}') as JmapRequest),
		calls: () => server.apiRequests().flatMap((request) => request.methodCalls),
		argsOf: (name) =>
			server
				.calls()
				.filter((call) => call[0] === name)
				.map((call) => call[1]),
	};
	return server;
}

/** Lets pending promise jobs and stream reads run (real macrotask turns, no global changes). */
export async function flush(turns = 20): Promise<void> {
	for (let turn = 0; turn < turns; turn++)
		await new Promise<void>((resolve) => setImmediate(resolve));
}

/** Waits until `condition` holds, failing the test when it never does. */
export async function until(condition: () => boolean, turns = 500): Promise<void> {
	for (let turn = 0; turn < turns; turn++) {
		if (condition()) return;
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	throw new Error('The condition never held.');
}
