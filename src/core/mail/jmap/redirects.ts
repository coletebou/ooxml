// Where the JMAP client's requests may go, and the redirects they follow on the way. Credentials
// and request bodies go over https only (plain http to a loopback host, for development): the
// address a request starts at is checked before anything is sent, whoever asked for it. Where the
// platform hands redirects back (`redirect: 'manual'`, as server-side fetch does), each hop is
// checked before it is taken: a 307 or 308 from https to plain http would send a draft or a file
// in clear, `Authorization` or not, and a chain through plain http that comes back to https would
// let whoever answers the http hop choose the server the rest of it reaches. Where the platform
// hides them (a browser's `opaqueredirect`), fetch follows them itself: a browser blocks the http
// hop as mixed content. Only the answer to a request that reached the server shows that it hides
// them, so that request goes again only when a second one does no harm: one that changes the server
// fails instead, as one whose outcome is not known. Moved from session discovery, which checked its
// own redirects. New code.
import { MailTransportError } from '../transport';
import { JmapError } from './errors';

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

/** Lets the connection go when a body will not be read. */
export async function discard(response: Response): Promise<void> {
	try {
		await response.body?.cancel();
	} catch {
		// Already consumed or closed.
	}
}

const sameOrigin = (a: string, b: string): boolean => new URL(a).origin === new URL(b).origin;

/** Redirects followed in a row before giving up (fetch itself follows 20). */
const MAX_REDIRECTS = 5;
/** The statuses fetch follows (Fetch, "redirect status"). */
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/** Headers about a request body, which a redirect that drops the body drops with it. */
const BODY_HEADERS = new Set([
	'content-encoding',
	'content-language',
	'content-location',
	'content-type',
]);

/** One request of a chain: where it goes, what it sends, and whether the credentials go too. */
export interface Hop {
	url: string;
	method: string;
	headers: Readonly<Record<string, string>>;
	body?: BodyInit;
	credentials: boolean;
	/** A POST the server may get twice: it only reads, or a second one does no harm. */
	repeatable?: boolean;
}

/** Where an exchange ended: the URL that answered, and whether the credentials went there. */
export interface Landed {
	url: string;
	credentials: boolean;
}

/** Whether redirects come back to be checked: `hidden` once the platform turns out to hide them. */
export interface RedirectMode {
	hidden: boolean;
}

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

/**
 * The request a redirect asks for (Fetch, "HTTP-redirect fetch"): a 303, or a 301 or 302 answering
 * a POST, goes on as a GET without the body; the others keep the method and the body. From the
 * first hop to another origin on, the credentials stay behind, as fetch leaves `Authorization`.
 */
function nextHop(hop: Hop, status: number, to: string, what: string): Hop {
	const credentials = hop.credentials && sameOrigin(to, hop.url);
	const get =
		(status === 303 && hop.method !== 'GET' && hop.method !== 'HEAD') ||
		(hop.method === 'POST' && (status === 301 || status === 302));
	if (get) {
		const headers = Object.fromEntries(
			Object.entries(hop.headers).filter(([name]) => !BODY_HEADERS.has(name.toLowerCase())),
		);
		return { url: to, method: 'GET', headers, credentials };
	}
	// A stream is read once: fetch cannot send it again, and neither can this.
	if (typeof ReadableStream !== 'undefined' && hop.body instanceof ReadableStream)
		throw new JmapError('network', `${what} was redirected with a body it cannot send again.`, {
			level: 'http',
		});
	return { ...hop, url: to, credentials };
}

/** Where fetch ended up, when it followed the redirects itself, and whether the credentials did. */
function landedAt(response: Response, hop: Hop): Landed {
	const url = response.url || hop.url;
	return {
		url,
		credentials: hop.credentials && !(response.redirected && !sameOrigin(url, hop.url)),
	};
}

/**
 * Sends `first` and follows the redirects that answer it. `first` is refused before it is sent
 * unless it goes where credentials may go (`isSafeUrl`); where the platform hands the redirects
 * back, each one is checked the same way before it is followed, `MAX_REDIRECTS` at most; where it
 * hides them, `mode.hidden` is set and fetch follows them from then on, so later requests do not
 * ask twice. The request that found that out reached the server, which may have acted on it (a 303
 * after a POST points at its result): it is sent again only when it is a GET or `repeatable`, and
 * fails otherwise.
 */
export async function followRedirects(
	first: Hop,
	send: (hop: Hop, redirect: 'manual' | 'follow') => Promise<Response>,
	mode: RedirectMode,
	what: string,
): Promise<{ response: Response; landed: Landed }> {
	if (!isSafeUrl(first.url))
		throw new MailTransportError(
			'invalid',
			`${what} may not go to that address (https, or http on localhost).`,
		);
	let hop = first;
	for (let hops = 0; !mode.hidden;) {
		const response = await send(hop, 'manual');
		if (response.type === 'opaqueredirect') {
			mode.hidden = true;
			if (hop.method === 'GET' || hop.method === 'HEAD' || hop.repeatable) break;
			// Neither refused nor known to be done: what a request that got no answer is.
			throw new JmapError(
				'network',
				`${what} was redirected after the server got it, and is not sent again.`,
				{ level: 'http' },
			);
		}
		const to = redirectTarget(response, hop.url);
		if (to === null) return { response, landed: landedAt(response, hop) };
		await discard(response);
		if (!isSafeUrl(to))
			throw new MailTransportError(
				'invalid',
				`${what} was redirected where it may not go (https, or http on localhost).`,
			);
		if (++hops > MAX_REDIRECTS)
			throw new JmapError('server', `${what} was redirected too many times.`, { level: 'http' });
		hop = nextHop(hop, response.status, to, what);
	}
	const response = await send(hop, 'follow');
	return { response, landed: landedAt(response, hop) };
}
