// Message search: the query a person types (`from:ada subject:"q3 plan" has:attachment report`)
// parsed into a `MailQuery`, and the matcher the memory transport runs. The JMAP client sends the
// same query to the server as an `Email/query` filter instead. New code.
import { stripHtmlTags } from '../collab/validation';
import { decodeHtmlCharacterReferences } from '../text/html-character-references';
import { FLAGGED, SEEN, type EmailSummary, type MailAddress } from './model';
import type { MailQuery } from './transport';

const FIELDS = new Set(['from', 'to', 'subject', 'body']);

/** Split on white space, keeping `"quoted phrases"` and `field:"quoted values"` whole. */
function tokens(input: string): string[] {
	const out: string[] = [];
	const pattern = /(\S+?:)?"([^"]*)"?|\S+/g;
	for (let match = pattern.exec(input); match; match = pattern.exec(input)) {
		out.push(
			match[1] !== undefined || match[2] !== undefined
				? `${match[1] ?? ''}${match[2] ?? ''}`
				: match[0],
		);
	}
	return out.filter(Boolean);
}

const dayStart = (text: string): number | undefined => {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
	if (!match) return undefined;
	const at = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
	return Number.isNaN(at) ? undefined : at;
};

const append = (current: string | undefined, value: string): string =>
	current ? `${current} ${value}` : value;

/**
 * Parse a search box. Understood: `from:`, `to:`, `subject:`, `body:`, `has:attachment`,
 * `is:unread`, `is:read`, `is:flagged`, `before:YYYY-MM-DD`, `after:YYYY-MM-DD` (UTC days); any
 * other word is free text. Repeated fields are combined (all of their words must match).
 */
export function parseSearch(input: string): MailQuery {
	const query: MailQuery = {};
	for (const token of tokens(input)) {
		const colon = token.indexOf(':');
		const field = colon > 0 ? token.slice(0, colon).toLowerCase() : '';
		const value = colon > 0 ? token.slice(colon + 1) : token;
		if (FIELDS.has(field) && value) {
			const key = field as 'from' | 'to' | 'subject' | 'body';
			query[key] = append(query[key], value);
		} else if (field === 'has' && value.toLowerCase() === 'attachment') query.hasAttachment = true;
		else if (field === 'is' && value.toLowerCase() === 'unread') query.unread = true;
		else if (field === 'is' && value.toLowerCase() === 'read') query.unread = false;
		else if (field === 'is' && value.toLowerCase() === 'flagged') query.flagged = true;
		else if ((field === 'before' || field === 'after') && dayStart(value) !== undefined)
			query[field] = dayStart(value)!;
		else query.text = append(query.text, token);
	}
	return query;
}

/** True when the query restricts anything beyond the mailbox. */
export function isSearch(query: MailQuery): boolean {
	return Object.entries(query).some(([key, value]) => key !== 'mailboxId' && value !== undefined);
}

/** What the matcher reads: a summary, plus the body when the transport has it. */
export interface SearchableEmail extends EmailSummary {
	text?: string | null;
	html?: string | null;
	/** The parts the HTML body was sent in, when there were several (`MailMessage.htmlParts`). */
	htmlParts?: readonly string[];
}

const fold = (text: string): string => text.normalize('NFKC').toLowerCase();
const words = (text: string): string[] => fold(text).split(/\s+/).filter(Boolean);
const addresses = (list: readonly MailAddress[]): string =>
	list.map((address) => `${address.name} ${address.email}`).join(' ');

/** Every word of `needle` occurs in `haystack` (case- and width-insensitive substrings). */
function containsAll(haystack: string, needle: string | undefined): boolean {
	if (needle === undefined) return true;
	const folded = fold(haystack);
	return words(needle).every((word) => folded.includes(word));
}

/**
 * Remove `<script>` and `<style>` elements with their contents in one linear pass (a lazy regex
 * with a back reference goes quadratic on many unclosed tags). An unclosed one runs to the end.
 * The next opener of each kind is looked for again only once the scan has passed it, so a kind
 * that is not there is searched for once, not once per element of the other kind. Tag names are
 * matched in ASCII case only, as HTML does, so every offset in the lower-cased copy is one in
 * `html`: full lower casing lengthens some characters (`İ` becomes two code units).
 */
export function dropScriptsAndStyles(html: string): string {
	const lower = html.replace(/[A-Z]+/g, (run) => run.toLowerCase());
	let out = '';
	let at = 0;
	let script = lower.indexOf('<script');
	let style = lower.indexOf('<style');
	for (;;) {
		if (script >= 0 && script < at) script = lower.indexOf('<script', at);
		if (style >= 0 && style < at) style = lower.indexOf('<style', at);
		const start = script < 0 ? style : style < 0 ? script : Math.min(script, style);
		if (start < 0) return out + html.slice(at);
		const tag = start === script ? '</script' : '</style';
		const close = lower.indexOf(tag, start);
		out += `${html.slice(at, start)} `;
		if (close < 0) return out;
		const end = lower.indexOf('>', close);
		if (end < 0) return out;
		at = end + 1;
	}
}

/**
 * The character references of `text` decoded as HTML reads them in an attribute value
 * (`decodeHtmlCharacterReferences` of the `text` area): every named and numeric one.
 */
export const decodeEntities: (text: string) => string = decodeHtmlCharacterReferences;

/**
 * Where a line ends in HTML: a line break or rule, or the end of a paragraph, block or row. A tag's
 * attributes stop at the next `<` too, so many unclosed tags cannot make the scan quadratic.
 */
const LINE_END = /<(?:br|hr)\b[^<>]*>|<\/(?:p|div|li|h[1-6]|blockquote|pre|tr)\s*>/gi;

/**
 * The text of HTML: no scripts, styles or tags, a line per paragraph or block, character references
 * decoded, and a no-break space, written or referenced, a space, as a text has it.
 */
export function htmlText(html: string): string {
	const text = stripHtmlTags(dropScriptsAndStyles(html).replace(LINE_END, '\n'));
	return decodeEntities(text).replace(/\u00a0/g, ' ');
}

/** A message's HTML body: as one text, and the parts it was sent in when there were several. */
interface HtmlBody {
	html?: string | null;
	/** `MailMessage.htmlParts`, `html` being them joined: read instead of `html` when set. */
	htmlParts?: readonly string[] | null | undefined;
}

/**
 * The text of a message's HTML body. One sent in several parts is read part by part, as a reader
 * shows it: read as one text, a part that ends in an unclosed `<style>` or `<script>` would take in
 * the parts after it. The parts' texts are joined as the text body's are, on a line break unless
 * the one before ends in one, so the words of two parts never run together.
 */
function htmlBodyText(email: HtmlBody): string {
	if (!email.htmlParts?.length) return email.html ? htmlText(email.html) : '';
	let text = '';
	for (const part of email.htmlParts) {
		const value = htmlText(part);
		text = text && !text.endsWith('\n') ? `${text}\n${value}` : text + value;
	}
	return text;
}

/**
 * The text of a message body: the plain text, else the HTML without its tags (part by part when it
 * was sent in several), else the preview.
 */
export function bodyText(email: HtmlBody & { text?: string | null; preview?: string }): string {
	if (email.text) return email.text;
	if (email.html) return htmlBodyText(email);
	return email.preview ?? '';
}

/**
 * What a body search reads: the plain text and the HTML's text both, since either may hold words
 * the other lacks (a short plain alternative, a fuller HTML one); the preview without either.
 */
function searchableBody(email: SearchableEmail): string {
	const parts = [email.text ?? '', htmlBodyText(email)].filter(Boolean);
	return parts.length ? parts.join('\n') : email.preview;
}

/** The memory transport's matcher: all of `query`'s conditions must hold. */
export function matchesQuery(email: SearchableEmail, query: MailQuery): boolean {
	if (query.mailboxId !== undefined && !email.mailboxIds.includes(query.mailboxId)) return false;
	if (query.hasAttachment !== undefined && email.hasAttachment !== query.hasAttachment)
		return false;
	if (query.unread !== undefined && (email.keywords[SEEN] !== true) !== query.unread) return false;
	if (query.flagged !== undefined && (email.keywords[FLAGGED] === true) !== query.flagged)
		return false;
	if (query.before !== undefined && !(email.receivedAt < query.before)) return false;
	if (query.after !== undefined && !(email.receivedAt >= query.after)) return false;
	const from = addresses(email.from);
	const to = addresses([...email.to, ...email.cc, ...email.bcc]);
	if (!containsAll(from, query.from) || !containsAll(to, query.to)) return false;
	if (!containsAll(email.subject, query.subject)) return false;
	if (query.body === undefined && query.text === undefined) return true;
	const body = searchableBody(email);
	if (!containsAll(body, query.body)) return false;
	return containsAll(`${email.subject} ${from} ${to} ${body}`, query.text);
}
