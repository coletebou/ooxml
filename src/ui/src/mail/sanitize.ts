// Making a message's HTML safe to show. DOMPurify removes scripts, forms, frames, event handlers and
// `javascript:` links; remote resources (images, backgrounds, every URL in CSS, `@import`) are
// blocked until the person allows them, and counted so the reading pane can say so; `cid:` images
// point at the message's own attachments; every link (an image map's areas too) opens in a new tab
// without an opener; what styles the html element and the body themselves, and the direction and
// language they give, is cleaned the same way. The result is then shown in a sandboxed frame
// without scripts and with a Content-Security-Policy (email-document.ts), so a sanitiser miss still
// cannot run code or fetch anything there. Compose puts the same HTML into the page itself, where
// no such policy applies, so the sanitiser must not miss.
// A body sent in several parts is cleaned part by part (`sanitizeMessageHtml`). New code.
import DOMPurify from 'dompurify';
import {
	BODY_ATTRIBUTES,
	HTML_ATTRIBUTES,
	type BodyAttribute,
	type BodyAttributes,
	type HtmlAttribute,
	type HtmlAttributes,
} from './email-document';
import { rewriteCss } from './sanitize-css';

export { emailDocument, type FrameStyle } from './email-document';

export interface SanitizeOptions {
	/** Load remote images and styles (the person chose "show images"). */
	allowRemote: boolean;
	/** `cid` (without angle brackets, lower case) to a URL of the attachment's bytes. */
	cidUrls?: ReadonlyMap<string, string>;
}

export interface SanitizedHtml {
	/**
	 * The message's own style sheets, cleaned: one per `<style>` element, in order (a body sent in
	 * several parts gives those of each part in turn). A frame writes each in a `<style>` of its own
	 * (`emailDocument`), so a browser reads each on its own and what one leaves unfinished at its
	 * end, such as a selector without its block, cannot reach into the next.
	 */
	sheets: readonly string[];
	/** The body markup, cleaned. */
	body: string;
	/**
	 * The attributes of the message's `<html>` element (`HTML_ATTRIBUTES`), cleaned as those of
	 * every element are: the direction and language of the whole message among them. The frame's
	 * html element takes them (`emailDocument`).
	 */
	htmlAttributes: HtmlAttributes;
	/**
	 * The attributes that style the message's own `<body>` (`BODY_ATTRIBUTES`), cleaned as those of
	 * every element are. The frame's body takes them (`emailDocument`), so the message is shown on
	 * its own background, which fills the frame.
	 */
	bodyAttributes: BodyAttributes;
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
/** How DOMPurify cleans a message's markup, and the attributes of its body. */
const PURIFY = {
	USE_PROFILES: { html: true },
	FORBID_TAGS,
	FORBID_ATTR,
	ALLOW_DATA_ATTR: false,
	ADD_ATTR: ['target'],
	ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|cid):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};
/** The colours only a `<body>` has, which DOMPurify does not know: allowed on the body alone. */
const BODY_ONLY = ['text', 'link', 'vlink', 'alink'];
/** The colours of a body, each read by a browser with the legacy colour rules. */
const BODY_COLOURS: ReadonlySet<string> = new Set(['bgcolor', ...BODY_ONLY]);
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

/**
 * The purifier with this module's hooks, or null where DOMPurify cannot work (no DOM: a server, a
 * worker). Nothing is kept then, so a page that gains a DOM later still gets one.
 */
function instance(): ReturnType<typeof DOMPurify> | null {
	if (purifier) return purifier;
	const made = DOMPurify(globalThis as unknown as Window & typeof globalThis);
	if (!made.isSupported) return null;
	purifier = made;
	purifier.addHook('uponSanitizeAttribute', (_node, data) => {
		if (data.attrName === 'style') data.attrValue = cleanCss(data.attrValue);
	});
	purifier.addHook('afterSanitizeAttributes', (node) => {
		const el = node as Element;
		// Whatever follows its `href` on a click, a link or an area of an image map, opens a new tab
		// without an opener or a referrer, whatever `target` and `rel` the message gave it.
		if (el.tagName === 'A' || el.hasAttribute('href')) {
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

/** The attributes of the html element and the body an earlier part of a message gave. */
type Taken = Record<'html' | 'body', Set<string>>;

/**
 * The attributes named in `names` of the message's own `<html>` or `<body>`, cleaned as those of
 * every element are: they go, on a body without content, through the same DOMPurify pass, so a
 * style goes through `cleanCss`, a picture through `resourceUrl` (blocked and counted as anywhere
 * else) and what is unsafe goes as it does anywhere. A colour the legacy colour rules find none in
 * (empty or `transparent`) goes too, so that the frame's own stays (`emailDocument`). One named in
 * `taken` (given by an earlier part of the message) is left out, and this element's own are added
 * to it.
 */
function cleanAttributes<Name extends string>(
	purify: ReturnType<typeof DOMPurify>,
	element: Element,
	names: readonly Name[],
	taken: Set<string>,
): Partial<Record<Name, string>> {
	const stand = element.ownerDocument.createElement('body');
	for (const name of names) {
		const value = element.getAttribute(name);
		if (value === null || taken.has(name)) continue;
		taken.add(name);
		stand.setAttribute(name, value);
	}
	if (!stand.hasAttributes()) return {};
	const clean = purify.sanitize(stand, {
		...PURIFY,
		ADD_ATTR: [...PURIFY.ADD_ATTR, ...BODY_ONLY],
		RETURN_DOM: true,
	}) as Element;
	const kept: Partial<Record<Name, string>> = {};
	for (const name of names) {
		const value = clean.getAttribute(name);
		if (value !== null && !(BODY_COLOURS.has(name) && /^(?:transparent)?$/i.test(value)))
			kept[name] = value;
	}
	return kept;
}

/**
 * The message's `<style>` blocks (head and body), its body, and what styles its html element and
 * its body, cleaned.
 */
export function sanitizeEmailHtml(html: string, options: SanitizeOptions): SanitizedHtml {
	return cleanText(html, options, { html: new Set(), body: new Set() });
}

/** `sanitizeEmailHtml` without the attributes named in `taken` (`cleanAttributes`). */
function cleanText(html: string, options: SanitizeOptions, taken: Taken): SanitizedHtml {
	const purify = instance();
	if (!purify || typeof DOMParser === 'undefined')
		return { sheets: [], body: '', htmlAttributes: {}, bodyAttributes: {}, blocked: 0, cids: [] };
	pass = { options, blocked: 0, cids: new Set() };
	try {
		const parsed = new DOMParser().parseFromString(html, 'text/html');
		const sheets = [...parsed.querySelectorAll('style')].map((style) =>
			cleanCss(style.textContent ?? ''),
		);
		const htmlAttributes = cleanAttributes(
			purify,
			parsed.documentElement,
			HTML_ATTRIBUTES,
			taken.html,
		);
		const bodyAttributes = cleanAttributes(purify, parsed.body, BODY_ATTRIBUTES, taken.body);
		const body = purify.sanitize(parsed.body.innerHTML, PURIFY);
		const { blocked, cids } = pass;
		return { sheets, body, htmlAttributes, bodyAttributes, blocked, cids: [...cids] };
	} finally {
		pass = null;
	}
}

/** A message's HTML body: `html`, and the parts it was sent in when there were several. */
export interface MessageHtml {
	html: string | null;
	/** `MailMessage.htmlParts`, `html` being them joined. */
	htmlParts?: readonly string[] | null | undefined;
}

/**
 * A message's HTML body cleaned as `sanitizeEmailHtml` cleans one text, part by part when it was
 * sent in several, as RFC 8621 asks: read as one text, a part that ends in an open comment or tag
 * would take in the parts after it. The bodies are joined in order and the style sheets kept in
 * order, each apart; what each part blocked is added up and the `cid`s they load are merged. The
 * html element and the body are styled as the parts read as one document would style them: a
 * parser gives each the attributes of a later `<html>` or `<body>` tag only where it has none of
 * its own, so the first part that gives one of them an attribute gives it, and one a later part
 * cannot give is neither cleaned nor counted.
 */
export function sanitizeMessageHtml(message: MessageHtml, options: SanitizeOptions): SanitizedHtml {
	const parts = message.htmlParts?.length ? message.htmlParts : [message.html ?? ''];
	const sheets: string[] = [];
	const htmlAttributes: Partial<Record<HtmlAttribute, string>> = {};
	const bodyAttributes: Partial<Record<BodyAttribute, string>> = {};
	const taken: Taken = { html: new Set(), body: new Set() };
	const cids = new Set<string>();
	let body = '';
	let blocked = 0;
	for (const part of parts) {
		const clean = cleanText(part, options, taken);
		// One at a time: a message may hold more style elements than a call takes arguments.
		for (const sheet of clean.sheets) sheets.push(sheet);
		body += clean.body;
		Object.assign(htmlAttributes, clean.htmlAttributes);
		Object.assign(bodyAttributes, clean.bodyAttributes);
		blocked += clean.blocked;
		for (const cid of clean.cids) cids.add(cid);
	}
	return { sheets, body, htmlAttributes, bodyAttributes, blocked, cids: [...cids] };
}
