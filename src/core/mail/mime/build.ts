// Writing an RFC 5322 message with MIME (RFC 2045, RFC 2046, RFC 2047, RFC 2231, RFC 2387): what a
// transport submits and what `.eml` export saves. New code.
import type { MailAddress } from '../model';
import { formatAddressList, formatMessageIds } from './addresses';
import { utf8 } from './binary';
import {
	attachmentPart,
	boundaries,
	randomHex,
	renderPart,
	textPart,
	type OutgoingAttachment,
	type PartNode,
} from './build-parts';
import { formatDate } from './dates';
import { encodeHeaderText } from './encoded-words';
import { foldHeader, type HeaderField } from './headers';

export type { OutgoingAttachment } from './build-parts';

export interface OutgoingEmail {
	from: MailAddress;
	sender?: MailAddress;
	to: readonly MailAddress[];
	cc?: readonly MailAddress[];
	bcc?: readonly MailAddress[];
	replyTo?: readonly MailAddress[];
	subject: string;
	/** The plain-text body, always written (the only part, or the `text/plain` alternative). */
	text: string;
	/** The HTML body, written as the `text/html` alternative when not empty. */
	html?: string;
	attachments?: readonly OutgoingAttachment[];
	/** Ids without angle brackets. A `Message-ID` is made up when `messageId` is missing. */
	messageId?: string;
	inReplyTo?: readonly string[];
	references?: readonly string[];
	/** The `Date` header, UTC milliseconds; `options.now()` when missing. */
	date?: number;
	/** More header fields; the ones this writer sets itself and `Content-*` are left out. */
	headers?: readonly HeaderField[];
}

export interface WriteOptions {
	/** The boundary of the `index`th multipart, outermost first; random when missing. */
	boundary?: (index: number) => string;
	/** The domain of a made-up `Message-ID`; the `From` domain, else `localhost`, when missing. */
	messageIdDomain?: string;
	now?: () => number;
	/** Write `Bcc`, as a saved draft must; a message as sent leaves it out. */
	includeBcc?: boolean;
}

const OWN_HEADERS = new Set([
	'date',
	'from',
	'sender',
	'reply-to',
	'to',
	'cc',
	'bcc',
	'subject',
	'message-id',
	'in-reply-to',
	'references',
	'mime-version',
]);
const FIELD_NAME = /^[!-9;-~]+$/;

/**
 * The part tree: the text alone, or `multipart/alternative` with the HTML, which goes in a
 * `multipart/related` with the attachments whose `cid:` it references (RFC 2387); any other
 * attachment makes the whole a `multipart/mixed`.
 */
function bodyNode(email: OutgoingEmail): PartNode {
	const attachments = email.attachments ?? [];
	const html = email.html ?? '';
	const markup = html.toLowerCase();
	const related = html
		? attachments.filter((item) => item.cid && markup.includes(`cid:${item.cid.toLowerCase()}`))
		: [];
	const mixed = attachments.filter((item) => !related.includes(item));
	let node: PartNode = textPart(email.text, 'plain');
	if (html) {
		const htmlPart = textPart(html, 'html');
		const inline = related.map((item) => attachmentPart(item, 'inline'));
		node = {
			subtype: 'alternative',
			parts: [
				node,
				inline.length
					? { subtype: 'related', params: { type: 'text/html' }, parts: [htmlPart, ...inline] }
					: htmlPart,
			],
		};
	}
	if (!mixed.length) return node;
	const files = mixed.map((item) => attachmentPart(item, item.inline ? 'inline' : 'attachment'));
	return { subtype: 'mixed', parts: [node, ...files] };
}

function domainOf(email: string): string | undefined {
	const at = email.lastIndexOf('@');
	const domain = email.slice(at + 1);
	return at >= 0 && /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*$/.test(domain) ? domain : undefined;
}

/**
 * A new Message-ID, without angle brackets, unique as RFC 5322 section 3.6.4 asks: the time `now`
 * and twelve random bytes, at `domain`, else at the domain of the address `from`, else `localhost`.
 */
export function newMessageId(now: number, from?: string, domain?: string): string {
	const right = domain ?? (from === undefined ? undefined : domainOf(from)) ?? 'localhost';
	return `${Math.trunc(now).toString(36)}.${randomHex(12)}@${right}`;
}

/**
 * Writes `email` as an RFC 5322 message: CRLF line endings, `MIME-Version: 1.0`, header fields
 * folded within 78 characters where a space allows, encoded words (RFC 2047) for non-ASCII header
 * text, RFC 2231 for non-ASCII file names, `7bit` or quoted-printable text, base64 in 76-character
 * lines for files, and no line over 998 characters. `Bcc` is written only with `includeBcc`.
 * Throws a `RangeError` for an invalid custom boundary.
 */
export function writeEmail(email: OutgoingEmail, options: WriteOptions = {}): Uint8Array {
	const valid = (time: number | undefined): time is number =>
		time !== undefined && Number.isFinite(new Date(time).getTime());
	const date = valid(email.date) ? email.date : (options.now ?? Date.now)();
	const lines: string[] = [];
	const add = (name: string, value: string): void => {
		if (value) lines.push(foldHeader(name, value));
	};
	const addresses = (name: string, list: readonly MailAddress[] | undefined): void =>
		add(name, formatAddressList(list ?? []));
	add('Date', formatDate(date));
	addresses('From', [email.from]);
	if (email.sender) addresses('Sender', [email.sender]);
	addresses('Reply-To', email.replyTo);
	addresses('To', email.to);
	addresses('Cc', email.cc);
	if (options.includeBcc) addresses('Bcc', email.bcc);
	// Written even when empty: a missing Subject is what spam filters count against a message.
	lines.push(foldHeader('Subject', encodeHeaderText(email.subject)));
	const made = newMessageId(date, email.from.email, options.messageIdDomain);
	add('Message-ID', formatMessageIds([email.messageId ?? '']) || formatMessageIds([made]));
	add('In-Reply-To', formatMessageIds(email.inReplyTo ?? []));
	add('References', formatMessageIds(email.references ?? []));
	for (const field of email.headers ?? []) {
		const key = field.name.toLowerCase();
		if (FIELD_NAME.test(field.name) && !OWN_HEADERS.has(key) && !key.startsWith('content-'))
			lines.push(foldHeader(field.name, encodeHeaderText(field.value)));
	}
	lines.push('MIME-Version: 1.0');
	const node = bodyNode(email);
	const root = renderPart(node, boundaries(options.boundary));
	const end = 'subtype' in node ? '\r\n' : '';
	return utf8(`${[...lines, ...root.headers].join('\r\n')}\r\n\r\n${root.body}${end}`);
}
