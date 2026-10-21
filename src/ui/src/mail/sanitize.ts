// Making a message's HTML safe to show. DOMPurify removes scripts, forms, frames, event handlers and
// `javascript:` links; remote resources (images, backgrounds, every URL in CSS, `@import`) are
// blocked until the person allows them, and counted so the reading pane can say so; `cid:` images
// point at the message's own attachments; every link opens in a new tab without an opener. The
// result is then shown in a sandboxed frame without scripts and with a Content-Security-Policy
// (`emailDocument`), so a sanitiser miss still cannot run code or fetch anything there. Compose puts
// the same HTML into the page itself, where no such policy applies, so the sanitiser must not miss.
// New code.
import DOMPurify from 'dompurify';
import { rewriteCss } from './sanitize-css';

export interface SanitizeOptions {
	/** Load remote images and styles (the person chose "show images"). */
	allowRemote: boolean;
	/** `cid` (without angle brackets, lower case) to a URL of the attachment's bytes. */
	cidUrls?: ReadonlyMap<string, string>;
}

export interface SanitizedHtml {
	/** The message's own styles, cleaned. */
	css: string;
	/** The body markup, cleaned. */
	body: string;
	/** Remote resources that were blocked. */
	blocked: number;
	/**
	 * The `cid`s (lower case, without angle brackets) of the parts the body and its styles load as
	 * images or backgrounds, whether or not they were found.
	 */
	cids: string[];
}

const FORBID_TAGS = [
	'script',
	'noscript',
	'template',
	'form',
	'input',
	'button',
	'textarea',
	'select',
	'option',
	'optgroup',
	'datalist',
	'output',
	'iframe',
	'frame',
	'frameset',
	'object',
	'embed',
	'applet',
	'portal',
	'base',
	'link',
	'meta',
	'audio',
	'video',
	'source',
	'track',
	'dialog',
	'style',
];
const FORBID_ATTR = ['srcset', 'formaction', 'action', 'ping', 'autofocus', 'srcdoc', 'poster'];
const REMOTE = /^\s*(?:https?:)?\/\//i;
const CID = /^\s*cid:(.+)$/i;

interface Pass {
	options: SanitizeOptions;
	blocked: number;
	cids: Set<string>;
}
let pass: Pass | null = null;
let purifier: ReturnType<typeof DOMPurify> | null = null;

/**
 * The Content-ID a `cid:` URL names, lower case: its escapes decoded (RFC 2392), then as written,
 * for a malformed escape or a sender that did not encode it.
 */
function cidKeys(url: string): string[] {
	const key = (text: string): string => text.trim().replace(/^<|>$/g, '').toLowerCase();
	const written = key(url);
	let decoded = written;
	try {
		decoded = key(decodeURIComponent(url));
	} catch {
		// A malformed escape: the text as written is all there is.
	}
	return decoded === written ? [written] : [decoded, written];
}

/** Resolve one URL of a resource the message loads: allowed, rewritten (cid) or blocked (''). */
function resourceUrl(url: string): string {
	const cid = CID.exec(url);
	if (cid) {
		const keys = cidKeys(cid[1]!);
		for (const key of keys) pass?.cids.add(key);
		for (const key of keys) {
			const target = pass?.options.cidUrls?.get(key);
			if (target) return target;
		}
		return '';
	}
	if (/^\s*data:image\//i.test(url)) return url;
	if (REMOTE.test(url)) {
		if (pass?.options.allowRemote) return url;
		if (pass) pass.blocked++;
		return '';
	}
	return '';
}

/**
 * Clean CSS text: no `@import`, no script-like constructs, every URL through `resourceUrl`. What
 * replaces a script-like construct keeps the brackets balanced (a function left open would take
 * every rule after it), and `behavior` only counts as the old property, not `scroll-behavior`.
 */
export function cleanCss(css: string): string {
	return rewriteCss(
		css
			.replace(/expression\s*\(/gi, 'x-blocked(')
			.replace(/(?<![\w-])behavior\s*:|-moz-binding\s*:|javascript:/gi, 'x-blocked:'),
		resourceUrl,
	);
}

function instance(): ReturnType<typeof DOMPurify> {
	if (purifier) return purifier;
	purifier = DOMPurify(globalThis as unknown as Window & typeof globalThis);
	purifier.addHook('uponSanitizeAttribute', (_node, data) => {
		if (data.attrName === 'style') data.attrValue = cleanCss(data.attrValue);
	});
	purifier.addHook('afterSanitizeAttributes', (node) => {
		const el = node as Element;
		if (el.tagName === 'A') {
			el.setAttribute('target', '_blank');
			el.setAttribute('rel', 'noopener noreferrer');
		}
		for (const name of ['src', 'background']) {
			const value = el.getAttribute(name);
			if (value === null) continue;
			const resolved = resourceUrl(value);
			if (resolved) el.setAttribute(name, resolved);
			else el.removeAttribute(name);
		}
	});
	return purifier;
}

/** The message's `<style>` blocks (head and body) and its body, each cleaned. */
export function sanitizeEmailHtml(html: string, options: SanitizeOptions): SanitizedHtml {
	const purify = instance();
	if (typeof purify.sanitize !== 'function' || typeof DOMParser === 'undefined')
		return { css: '', body: '', blocked: 0, cids: [] };
	pass = { options, blocked: 0, cids: new Set() };
	try {
		const parsed = new DOMParser().parseFromString(html, 'text/html');
		const css = [...parsed.querySelectorAll('style')].map((style) =>
			cleanCss(style.textContent ?? ''),
		);
		const body = purify.sanitize(parsed.body.innerHTML, {
			USE_PROFILES: { html: true },
			FORBID_TAGS,
			FORBID_ATTR,
			ALLOW_DATA_ATTR: false,
			ADD_ATTR: ['target'],
			ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|cid):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
		});
		return { css: css.join('\n'), body, blocked: pass.blocked, cids: [...pass.cids] };
	} finally {
		pass = null;
	}
}

/** Colours and type of the frame, read from the host's tokens (the frame cannot see them). */
export interface FrameStyle {
	font: string;
	fontSize: string;
	color: string;
	background: string;
	link: string;
	quote: string;
}

/**
 * The frame's whole document: a CSP that allows inline styles and, only when `allowRemote`, remote
 * images and fonts; links open in a new tab. Message HTML is written for a light page, so it is
 * shown on paper colours in every theme. The message's styles cannot end their element early: an
 * end tag starts `</s`, and each one there becomes `<\/s`, the same `/` to CSS. Nothing else is
 * touched, so a comment opened right after a `<` stays a comment.
 */
export function emailDocument(
	content: Pick<SanitizedHtml, 'css' | 'body'>,
	allowRemote: boolean,
	style: FrameStyle,
): string {
	const remote = allowRemote ? ' https: http:' : '';
	const csp = [
		"default-src 'none'",
		`img-src data: blob:${remote}`,
		"style-src 'unsafe-inline'",
		`font-src data:${remote}`,
		"media-src 'none'",
		"frame-src 'none'",
		"form-action 'none'",
		"base-uri 'none'",
	].join('; ');
	const base = `html{color-scheme:light}body{margin:0;padding:.75em;font-family:${style.font};font-size:${style.fontSize};color:${style.color};background:${style.background};overflow-wrap:anywhere}a{color:${style.link}}img{max-width:100%;height:auto}blockquote{margin:0 0 0 .5em;padding-left:.75em;border-left:.2em solid ${style.quote}}pre{white-space:pre-wrap}`;
	return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>${base}</style><style>${content.css.replace(/<\/(?=s)/gi, '<\\/')}</style></head><body>${content.body}</body></html>`;
}

export interface TextSegment {
	text: string;
	/** Set on a link: an `http(s)` or `mailto` address. */
	href?: string;
}

/** Where a found link points: an address becomes `mailto:`, a bare `www.` host `https://`. */
function linkHref(value: string): string {
	if (value.includes('@') && !/^https?:|^www\./i.test(value)) return `mailto:${value}`;
	if (/^www\./i.test(value)) return `https://${value}`;
	return value;
}

/** Plain text split into text and links (`https://...`, `www....`, addresses), never markup. */
export function linkify(text: string): TextSegment[] {
	const out: TextSegment[] = [];
	// Bounded quantifiers (RFC 5321 length limits for addresses) keep this linear on hostile text.
	const pattern =
		/\b(?:https?:\/\/|www\.)[^\s<>"]{0,2048}[^\s<>".,;:!?)\]]|\b[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}\b/gi;
	let at = 0;
	for (const match of text.matchAll(pattern)) {
		const start = match.index ?? 0;
		if (start > at) out.push({ text: text.slice(at, start) });
		const value = match[0];
		out.push({ text: value, href: linkHref(value) });
		at = start + value.length;
	}
	if (at < text.length) out.push({ text: text.slice(at) });
	return out;
}
