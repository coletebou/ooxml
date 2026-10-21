// HTTP for the JMAP client: the `Authorization` header built for each request from the credentials,
// `fetch` and status failures as `JmapError`s, JSON bodies, URI templates (RFC 6570 level 1) and
// the rule that credentials only travel over https (plain http for loopback hosts). New code.
import { encodeBase64 } from '../../digest/base64';
import { MailTransportError } from '../transport';
import { JmapError, createRedactor, networkError, responseError, type Redact } from './errors';

/** Credentials for every request. They are never logged, stored or put in a URL or an error. */
export type JmapAuth =
	| { type: 'bearer'; token: string }
	| { type: 'basic'; username: string; password: string };

const utf8 = new TextEncoder();

function secretsOf(auth: JmapAuth): string[] {
	if (auth.type === 'bearer') return [auth.token];
	const pair = `${auth.username}:${auth.password}`;
	return [auth.password, pair, encodeBase64(utf8.encode(pair))];
}

/** The `Authorization` value: `Bearer <token>` or `Basic base64(user:password)` over UTF-8. */
export function authorization(auth: JmapAuth): string {
	if (auth.type === 'basic')
		return `Basic ${encodeBase64(utf8.encode(`${auth.username}:${auth.password}`))}`;
	// A header error message would quote the token, so refuse what a header cannot carry first.
	if (!auth.token || /[^\x21-\x7e]/.test(auth.token))
		throw new MailTransportError(
			'unauthorized',
			'The access token is empty or not printable ASCII.',
		);
	return `Bearer ${auth.token}`;
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
	/** Hand a redirect back, to check where it goes before following it, instead of following it. */
	redirect?: 'manual';
	/** Leave the credentials out: a hop to another origin, where fetch drops them too. */
	anonymous?: boolean;
}

export interface JmapHttp {
	readonly redact: Redact;
	/** One authenticated exchange: `read` consumes the response; failures become `JmapError`s. */
	exchange<T>(
		url: string,
		init: JmapHttpInit,
		what: string,
		read: (response: Response) => Promise<T>,
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

/** Lets the connection go when a body will not be read. */
export async function discard(response: Response): Promise<void> {
	try {
		await response.body?.cancel();
	} catch {
		// Already consumed or closed.
	}
}

export function createJmapHttp(options: JmapHttpOptions): JmapHttp {
	const redact = createRedactor(secretsOf(options.auth));

	const request = async (
		url: string,
		init: JmapHttpInit,
		signal: AbortSignal | undefined,
		what: string,
	) => {
		const doFetch = options.fetch ?? globalThis.fetch;
		if (typeof doFetch !== 'function')
			throw new MailTransportError('unsupported', 'This platform has no fetch.');
		const headers = init.anonymous
			? { ...init.headers }
			: { ...init.headers, Authorization: authorization(options.auth) };
		try {
			return await doFetch(url, {
				method: init.method,
				headers,
				...(init.body === undefined ? {} : { body: init.body }),
				...(signal ? { signal } : {}),
				credentials: 'omit',
				redirect: init.redirect ?? 'follow',
			});
		} catch (error) {
			if (signal?.aborted) throw abortReason(signal);
			throw networkError(what, error, redact);
		}
	};

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
			try {
				const response = await request(url, init, signal, what);
				if (!response.ok && !init.anyStatus) throw await responseError(response, what, redact);
				return await read(response);
			} catch (error) {
				if (signal?.aborted) throw abortReason(signal);
				throw error;
			} finally {
				release();
			}
		},
		open: (url, init, what) => request(url, init, init.signal, what),
	};
}

/**
 * Expands a URI Template of level 1 (RFC 6570), as the session's download, upload and event
 * source URLs are: each `{name}` becomes its percent-encoded value, unknown names nothing.
 */
export function expandTemplate(template: string, values: Readonly<Record<string, string>>): string {
	return template.replace(/\{([^{}]*)\}/g, (_match, name: string) => {
		const value = Object.hasOwn(values, name) ? values[name] : undefined;
		return value === undefined ? '' : encodeURIComponent(value);
	});
}

/** Resolves a (possibly relative) URL template against `base`, keeping its `{variables}` intact. */
export function resolveTemplate(template: string, base: string): string {
	const variables: string[] = [];
	// The URL parser would percent-encode braces in a path; lower-case letters and digits it keeps.
	const masked = template.replace(/\{[^{}]*\}/g, (match) => `jmapvar${variables.push(match) - 1}x`);
	return new URL(masked, base).href.replace(/jmapvar(\d+)x/g, (_match, index: string) => {
		return variables[Number(index)] ?? '';
	});
}

const LOOPBACK = /^(?:(?:[\w-]+\.)*localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

/** True for a URL credentials may go to: https, or http to a loopback host; never with userinfo. */
export function isSafeUrl(href: string): boolean {
	let url: URL;
	try {
		url = new URL(href);
	} catch {
		return false;
	}
	if (url.username || url.password) return false;
	return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.test(url.hostname));
}

/**
 * The session resource for what a person typed: a session URL as given, or a bare origin
 * (`jmap.example.com`, `https://jmap.example.com/`) with `/.well-known/jmap` (RFC 8620 2.2).
 */
export function sessionResourceUrl(input: string): string {
	const trimmed = input.trim();
	let url: URL;
	try {
		url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
	} catch {
		throw new MailTransportError('invalid', 'The JMAP server address is not a valid URL.');
	}
	if (url.username || url.password)
		throw new MailTransportError(
			'invalid',
			'Pass credentials as auth, never in the server address.',
		);
	if (!isSafeUrl(url.href))
		throw new MailTransportError(
			'invalid',
			'The JMAP server must use https (http only on localhost).',
		);
	if (url.pathname === '/' && !url.search) url.pathname = '/.well-known/jmap';
	return url.href;
}
