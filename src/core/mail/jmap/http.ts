// HTTP for the JMAP client: the `Authorization` header built for each request from the credentials,
// `fetch` and status failures as `JmapError`s, JSON bodies, the rule that credentials and request
// bodies only travel over https (plain http for loopback hosts), redirects included
// (`redirects.ts`), and gates that keep the exchanges of one kind to as many at once as the server
// takes. The session's URLs and templates are in `urls.ts`. New code.
import { encodeBase64 } from '../../digest/base64';
import { MailTransportError } from '../transport';
import { JmapError, createRedactor, networkError, responseError, type Redact } from './errors';
import { followRedirects, type Hop, type Landed, type RedirectMode } from './redirects';

export { discard, isSafeUrl } from './redirects';

/**
 * A bearer token, or a function that gives the current one (it may be async). The function is
 * asked before each request, so a token refreshed meanwhile goes with the next one: a host whose
 * tokens expire keeps its connection, and what the client holds (an open draft), by giving the
 * same function each time.
 */
export type JmapToken = string | (() => string | Promise<string>);

/** Credentials for every request. They are never logged, stored or put in a URL or an error. */
export type JmapAuth =
	| { type: 'bearer'; token: JmapToken }
	| { type: 'basic'; username: string; password: string };

const utf8 = new TextEncoder();

function secretsOf(auth: JmapAuth): string[] {
	if (auth.type === 'bearer') return typeof auth.token === 'string' ? [auth.token] : [];
	const pair = `${auth.username}:${auth.password}`;
	return [auth.password, pair, encodeBase64(utf8.encode(pair))];
}

/** The token a bearer gives now; a function that fails or gives no text is refused, unquoted. */
async function currentToken(token: JmapToken): Promise<string> {
	if (typeof token === 'string') return token;
	try {
		const value: unknown = await token();
		if (typeof value === 'string') return value;
	} catch {
		// Not kept as the cause: what the host's function throws may quote what it refreshes with.
	}
	throw new MailTransportError('unauthorized', 'The access token could not be read.');
}

/**
 * The `Authorization` value: `Bearer <token>` or `Basic base64(user:password)` over UTF-8. `seen`
 * learns each token read, so that errors are scrubbed of it.
 */
export async function authorization(
	auth: JmapAuth,
	seen?: (secret: string) => void,
): Promise<string> {
	if (auth.type === 'basic')
		return `Basic ${encodeBase64(utf8.encode(`${auth.username}:${auth.password}`))}`;
	const token = await currentToken(auth.token);
	if (token) seen?.(token);
	// A header error message would quote the token, so refuse what a header cannot carry first.
	if (!token || /[^\x21-\x7e]/.test(token))
		throw new MailTransportError(
			'unauthorized',
			'The access token is empty or not printable ASCII.',
		);
	return `Bearer ${token}`;
}

export interface JmapHttpOptions {
	auth: JmapAuth;
	fetch?: typeof fetch;
	/** Aborts every request made through this client (the transport's lifetime). */
	signal?: AbortSignal;
}

export interface JmapHttpInit {
	method: 'GET' | 'POST';
	headers?: Record<string, string>;
	body?: BodyInit;
	signal?: AbortSignal;
	/** Leave a failure status to `read` instead of throwing it. */
	anyStatus?: boolean;
	/** `exchange` waits for a slot of this before the request goes, and holds it until read. */
	gate?: JmapGate;
	/** A POST the server may get twice: sent again after a redirect a browser hides. */
	repeatable?: boolean;
}

/** Slots for exchanges in flight at once: a server takes so many at a time (RFC 8620 2). */
export interface JmapGate {
	/**
	 * Waits for a free slot, in turn, and resolves to the function that frees it (once, however
	 * often it is called). A wait whose signal aborts leaves the queue with the signal's reason.
	 */
	enter(signal?: AbortSignal): Promise<() => void>;
}

export interface JmapHttp {
	readonly redact: Redact;
	/**
	 * One authenticated exchange, its address and its redirects checked hop by hop: `read`
	 * consumes the response (`landed`: where it came from, and whether the credentials went
	 * there); failures become `JmapError`s.
	 */
	exchange<T>(
		url: string,
		init: JmapHttpInit,
		what: string,
		read: (response: Response, landed: Landed) => Promise<T>,
	): Promise<T>;
	/** An authenticated request whose body the caller streams (push); any status resolves. */
	open(url: string, init: JmapHttpInit, what: string): Promise<Response>;
	json(response: Response, what: string): Promise<unknown>;
}

function abortReason(signal: AbortSignal): unknown {
	const reason: unknown = signal.reason;
	return reason instanceof Error
		? reason
		: new DOMException('The request was aborted.', 'AbortError');
}

/**
 * A gate of `limit()` slots (at least one). The limit is read each time a slot is given out, so
 * that of a refetched session applies from then on.
 */
export function createJmapGate(limit: () => number): JmapGate {
	let held = 0;
	/** The waits, oldest first; each takes its slot when called. */
	const waiting = new Set<() => void>();
	const admit = (): void => {
		for (const next of waiting) {
			if (held >= Math.max(1, limit())) return;
			waiting.delete(next);
			held++;
			next();
		}
	};
	const enter = (signal?: AbortSignal): Promise<() => void> =>
		new Promise((resolve, reject) => {
			if (signal?.aborted) {
				reject(abortReason(signal));
				return;
			}
			let freed = false;
			const free = (): void => {
				if (freed) return;
				freed = true;
				held--;
				admit();
			};
			const onAbort = (): void => {
				waiting.delete(take);
				if (signal) reject(abortReason(signal));
			};
			const take = (): void => {
				signal?.removeEventListener('abort', onAbort);
				resolve(free);
			};
			signal?.addEventListener('abort', onAbort, { once: true });
			waiting.add(take);
			admit();
		});
	return { enter };
}

/** One signal for both, and a function to drop the link once the exchange is over. */
function linkSignals(
	first: AbortSignal | undefined,
	second: AbortSignal | undefined,
): { signal: AbortSignal | undefined; release: () => void } {
	if (!first || !second) return { signal: first ?? second, release: () => {} };
	const controller = new AbortController();
	const onFirst = (): void => controller.abort(first.reason);
	const onSecond = (): void => controller.abort(second.reason);
	if (first.aborted) onFirst();
	else if (second.aborted) onSecond();
	first.addEventListener('abort', onFirst, { once: true });
	second.addEventListener('abort', onSecond, { once: true });
	return {
		signal: controller.signal,
		release: () => {
			first.removeEventListener('abort', onFirst);
			second.removeEventListener('abort', onSecond);
		},
	};
}

export function createJmapHttp(options: JmapHttpOptions): JmapHttp {
	/** Every secret sent so far: each token a function gave is scrubbed from errors too. */
	const secrets = new Set(secretsOf(options.auth));
	const redact: Redact = (text) => createRedactor([...secrets])(text);
	/** Learnt once: a platform that hides redirects hides them from every request. */
	const redirects: RedirectMode = { hidden: false };

	/** One hop of a request, the credentials with it only when `hop` says so. */
	const send = async (
		hop: Hop,
		redirect: 'manual' | 'follow',
		signal: AbortSignal | undefined,
		what: string,
	): Promise<Response> => {
		const doFetch = options.fetch ?? globalThis.fetch;
		if (typeof doFetch !== 'function')
			throw new MailTransportError('unsupported', 'This platform has no fetch.');
		const headers = hop.credentials
			? {
					...hop.headers,
					Authorization: await authorization(options.auth, (secret) => secrets.add(secret)),
				}
			: { ...hop.headers };
		try {
			return await doFetch(hop.url, {
				method: hop.method,
				headers,
				...(hop.body === undefined ? {} : { body: hop.body }),
				...(signal ? { signal } : {}),
				credentials: 'omit',
				redirect,
			});
		} catch (error) {
			if (signal?.aborted) throw abortReason(signal);
			throw networkError(what, error, redact);
		}
	};

	const request = (
		url: string,
		init: JmapHttpInit,
		signal: AbortSignal | undefined,
		what: string,
	): Promise<{ response: Response; landed: Landed }> =>
		followRedirects(
			{
				url,
				method: init.method,
				headers: { ...init.headers },
				...(init.body === undefined ? {} : { body: init.body }),
				credentials: true,
				...(init.repeatable ? { repeatable: true } : {}),
			},
			(hop, redirect) => send(hop, redirect, signal, what),
			redirects,
			what,
		);

	const json = async (response: Response, what: string): Promise<unknown> => {
		let text: string;
		try {
			text = await response.text();
		} catch (error) {
			throw networkError(what, error, redact);
		}
		try {
			return JSON.parse(text) as unknown;
		} catch {
			// No cause: a SyntaxError quotes the start of the body, which could hold part of a secret
			// that whole-secret scrubbing would miss.
			throw new JmapError('server', `${what} returned a body that is not JSON.`, {
				level: 'http',
				status: response.status,
			});
		}
	};

	return {
		redact,
		json,
		async exchange(url, init, what, read) {
			const { signal, release } = linkSignals(init.signal, options.signal);
			let leave = (): void => {};
			try {
				if (init.gate) leave = await init.gate.enter(signal);
				const { response, landed } = await request(url, init, signal, what);
				if (!response.ok && !init.anyStatus) throw await responseError(response, what, redact);
				return await read(response, landed);
			} catch (error) {
				if (signal?.aborted) throw abortReason(signal);
				throw error;
			} finally {
				leave();
				release();
			}
		},
		open: async (url, init, what) => (await request(url, init, init.signal, what)).response,
	};
}
