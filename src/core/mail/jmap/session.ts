// JMAP session discovery and validation (RFC 8620 2, 2.2): the session resource is read with the
// credentials, checked for the core and mail capabilities, and its endpoint URLs resolved against
// where it was found. New code.
import { MailTransportError } from '../transport';
import { JmapError, responseError } from './errors';
import {
	createJmapHttp,
	discard,
	isSafeUrl,
	resolveTemplate,
	sessionResourceUrl,
	type JmapAuth,
	type JmapHttp,
	type JmapHttpInit,
} from './http';
import { CORE, MAIL, isRecord } from './types';

/** The request limits of `urn:ietf:params:jmap:core`; the RFC's suggested minimums when absent. */
export interface JmapLimits {
	/** Octets one upload may hold; `Infinity` when the server does not say. */
	maxSizeUpload: number;
	maxCallsInRequest: number;
	maxObjectsInGet: number;
	maxObjectsInSet: number;
}

export interface JmapSessionAccount {
	id: string;
	name: string;
	isPersonal: boolean;
	isReadOnly: boolean;
	/** `accountCapabilities`: what this account can be used for, by capability URI. */
	capabilities: Readonly<Record<string, unknown>>;
}

/** A validated Session object (RFC 8620 2) with absolute endpoint URLs. */
export interface JmapSession {
	/**
	 * The session resource it was read from, after redirects; refetched from there, so it is https
	 * (or http to a loopback host) like every endpoint.
	 */
	url: string;
	capabilities: Readonly<Record<string, unknown>>;
	accounts: Readonly<Record<string, JmapSessionAccount>>;
	primaryAccounts: Readonly<Record<string, string>>;
	username: string;
	apiUrl: string;
	/** URI templates (RFC 6570 level 1), resolved but not expanded. */
	downloadUrl: string;
	uploadUrl: string;
	/** `null` when the server offers no event source, or offers it without https. */
	eventSourceUrl: string | null;
	state: string;
	limits: JmapLimits;
}

const positive = (value: unknown, fallback: number): number =>
	typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;

const malformed = (what: string): MailTransportError =>
	new MailTransportError('server', `The JMAP session is malformed: ${what}.`);

// Maps keyed by server strings are built with `Object.fromEntries`, which keeps a `__proto__` key
// an ordinary own property.
function parseAccounts(value: unknown): Record<string, JmapSessionAccount> {
	if (!isRecord(value)) throw malformed('no accounts');
	const entries: [string, JmapSessionAccount][] = [];
	for (const [id, account] of Object.entries(value)) {
		if (!isRecord(account)) continue;
		entries.push([
			id,
			{
				id,
				name: typeof account.name === 'string' ? account.name : id,
				isPersonal: account.isPersonal !== false,
				isReadOnly: account.isReadOnly === true,
				capabilities: isRecord(account.accountCapabilities) ? account.accountCapabilities : {},
			},
		]);
	}
	return Object.fromEntries(entries);
}

/**
 * Validates a Session object read from `url` and resolves its endpoints against `url`. The session
 * is read from `url` again, with the credentials, so a `url` they may not go to is refused: a
 * session a redirect took to plain http may be anyone's, endpoints included.
 */
export function parseJmapSession(json: unknown, url: string): JmapSession {
	if (!isSafeUrl(url))
		throw new MailTransportError(
			'invalid',
			'The JMAP session must be read over https (http only on localhost).',
		);
	if (!isRecord(json) || !isRecord(json.capabilities) || !isRecord(json.capabilities[CORE]))
		throw new MailTransportError('unsupported', 'The server did not answer with a JMAP session.');
	const capabilities = json.capabilities;
	if (!Object.hasOwn(capabilities, MAIL))
		throw new MailTransportError('unsupported', 'The JMAP server does not offer mail.');
	const core = capabilities[CORE] as Record<string, unknown>;
	const endpoint = (key: string): string | null => {
		const value = json[key];
		if (typeof value !== 'string' || !value) return null;
		let href: string;
		try {
			href = resolveTemplate(value, url);
		} catch {
			throw malformed(`${key} is not a URL`);
		}
		return isSafeUrl(href) ? href : null;
	};
	const required = (key: string): string => {
		const href = endpoint(key);
		if (href) return href;
		throw typeof json[key] === 'string' && json[key]
			? new MailTransportError('invalid', `The JMAP session's ${key} does not use https.`)
			: malformed(`no ${key}`);
	};
	const primaryAccounts = Object.fromEntries(
		Object.entries(isRecord(json.primaryAccounts) ? json.primaryAccounts : {}).filter(
			(entry): entry is [string, string] => typeof entry[1] === 'string',
		),
	);
	return {
		url,
		capabilities,
		accounts: parseAccounts(json.accounts),
		primaryAccounts,
		username: typeof json.username === 'string' ? json.username : '',
		apiUrl: required('apiUrl'),
		downloadUrl: required('downloadUrl'),
		uploadUrl: required('uploadUrl'),
		eventSourceUrl: endpoint('eventSourceUrl'),
		state: typeof json.state === 'string' ? json.state : '',
		limits: {
			maxSizeUpload: positive(core.maxSizeUpload, Number.POSITIVE_INFINITY),
			maxCallsInRequest: positive(core.maxCallsInRequest, 16),
			maxObjectsInGet: positive(core.maxObjectsInGet, 500),
			maxObjectsInSet: positive(core.maxObjectsInSet, 500),
		},
	};
}

const sameOrigin = (a: string, b: string): boolean => new URL(a).origin === new URL(b).origin;

/** Redirects of the session resource followed before giving up (fetch itself follows 20). */
const MAX_REDIRECTS = 5;
/** The statuses fetch follows (Fetch, "redirect status"). */
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Where a redirect sends the request, resolved against `from` ('' if no URL); null if none. */
function redirectTarget(response: Response, from: string): string | null {
	const location = REDIRECTS.has(response.status) ? response.headers.get('location') : null;
	if (location === null) return null;
	try {
		return new URL(location, from).href;
	} catch {
		return '';
	}
}

/** What one request of discovery came to. */
type Step =
	| { kind: 'session'; session: JmapSession }
	| { kind: 'redirect'; to: string }
	/** The platform hides where the redirect goes (a browser's `opaqueredirect`). */
	| { kind: 'hidden' }
	/** A 401 from where the credentials were left behind: ask there again, with them. */
	| { kind: 'retry'; at: string };

/**
 * Reads the session resource at `url` through `http`, the credentials going with it. Where the
 * platform hands redirects back (`redirect: 'manual'`), each one is checked before it is followed
 * and refused unless the credentials may go where it points: a chain through plain http that comes
 * back to https would let whoever answers the http hop send discovery to a server of their own,
 * whose session then names the endpoints the credentials go to. Where the platform hides them (a
 * browser), fetch follows them: a browser blocks the http hop itself as mixed content, and the
 * session is checked as read from where fetch ended up.
 */
export async function loadJmapSession(
	http: JmapHttp,
	url: string,
	signal?: AbortSignal,
): Promise<JmapSession> {
	const what = 'Loading the JMAP session';
	const read = async (response: Response, from: string): Promise<JmapSession> => {
		let json: unknown;
		try {
			json = await http.json(response, what);
		} catch (error) {
			// A page that is not JSON at all: most likely the address of something else.
			if (error instanceof JmapError && error.code === 'server')
				throw new MailTransportError(
					'unsupported',
					'The server did not answer with a JMAP session.',
					{
						cause: error,
					},
				);
			throw error;
		}
		return parseJmapSession(json, from);
	};
	let target = url;
	/** The credentials go along: fetch drops them on a hop to another origin, and so does this. */
	let credentials = true;
	/** Redirects come back to be checked; false once the platform turns out to hide them. */
	let manual = true;
	let retried = false;
	let hops = 0;
	for (;;) {
		const from = target;
		const init: JmapHttpInit = {
			method: 'GET',
			headers: { Accept: 'application/json' },
			anyStatus: true,
			...(manual ? { redirect: 'manual' as const } : {}),
			...(credentials ? {} : { anonymous: true }),
			...(signal ? { signal } : {}),
		};
		const step = await http.exchange<Step>(from, init, what, async (response) => {
			if (manual && response.type === 'opaqueredirect') return { kind: 'hidden' };
			const to = manual ? redirectTarget(response, from) : null;
			if (to !== null) {
				await discard(response);
				return { kind: 'redirect', to };
			}
			// Where fetch ended up, when it followed the redirects itself.
			const at = response.url || from;
			if (response.ok) return { kind: 'session', session: await read(response, at) };
			// A cross-origin redirect, which `/.well-known/jmap` often is, leaves `Authorization`
			// behind: ask its target directly.
			const dropped = !credentials || (response.redirected && !sameOrigin(at, from));
			if (response.status === 401 && dropped && !retried && isSafeUrl(at)) {
				await discard(response);
				return { kind: 'retry', at };
			}
			throw await responseError(response, what, http.redact);
		});
		if (step.kind === 'session') return step.session;
		if (step.kind === 'hidden') manual = false;
		else if (step.kind === 'retry') {
			retried = true;
			credentials = true;
			target = step.at;
		} else {
			if (!isSafeUrl(step.to))
				throw new MailTransportError(
					'invalid',
					'The JMAP session redirects where credentials may not go (https, or http on localhost).',
				);
			if (++hops > MAX_REDIRECTS)
				throw new JmapError('server', `${what} was redirected too many times.`, { level: 'http' });
			credentials &&= sameOrigin(step.to, from);
			target = step.to;
		}
	}
}

export interface DiscoverJmapSessionOptions {
	/** A server origin (discovery through `/.well-known/jmap`) or the session resource URL. */
	url: string;
	auth: JmapAuth;
	fetch?: typeof fetch;
	signal?: AbortSignal;
}

/** Finds and validates the JMAP session of a server (RFC 8620 2.2). */
export async function discoverJmapSession(
	options: DiscoverJmapSessionOptions,
): Promise<JmapSession> {
	const http = createJmapHttp({
		auth: options.auth,
		...(options.fetch ? { fetch: options.fetch } : {}),
	});
	return loadJmapSession(http, sessionResourceUrl(options.url), options.signal);
}

/** The account to use: `preferred`, else the primary mail account, else any account with mail. */
export function mailAccountId(session: JmapSession, preferred?: string): string {
	if (preferred !== undefined) {
		if (Object.hasOwn(session.accounts, preferred)) return preferred;
		throw new MailTransportError('notFound', 'The JMAP server has no such account.');
	}
	const primary = session.primaryAccounts[MAIL];
	if (primary !== undefined && Object.hasOwn(session.accounts, primary)) return primary;
	const any = Object.values(session.accounts).find((account) =>
		Object.hasOwn(account.capabilities, MAIL),
	);
	if (any) return any.id;
	throw new MailTransportError('unsupported', 'No account on the JMAP server offers mail.');
}

/** True when the server and the account offer `uri` (an account that lists none inherits all). */
export function accountHas(session: JmapSession, accountId: string, uri: string): boolean {
	if (!Object.hasOwn(session.capabilities, uri)) return false;
	const account = session.accounts[accountId];
	if (!account) return false;
	return Object.keys(account.capabilities).length === 0 || Object.hasOwn(account.capabilities, uri);
}
