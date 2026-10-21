// Reading a raw RFC 5322 message: its header fields, its MIME tree (RFC 2045, RFC 2046), and the
// text, HTML and attachments RFC 8621 section 4.1.4 finds in it. Never throws: malformed input is
// read as far as it goes. New code.
import { parseAddressList, parseContentId, parseMessageIds } from './addresses';
import { plainBytes, utf8 } from './binary';
import { decodeUnlabelled } from './charset';
import { parseDate } from './dates';
import { decodeEncodedWords } from './encoded-words';
import { cleanFileName, emlFileName, extensionFor } from './file-names';
import { getHeader, parseHeaders, splitMessage, type HeaderField } from './headers';
import { splitMultipart, type MultipartSplit } from './multipart';
import { parseContentDisposition, parseContentType } from './parameters';
import { messageBodies } from './structure';
import { decodeTransfer, transferEncoding } from './transfer';
import type { MimePart, ParsedAttachment, ParsedEmail } from './types';

export interface ReadOptions {
	/** How deep multiparts and attached messages may nest; deeper ones are kept whole (20). */
	maxDepth?: number;
	/** How many parts are read; the rest of the multipart then is kept whole (1000). */
	maxParts?: number;
}

interface State {
	parts: number;
	readonly maxParts: number;
	readonly maxDepth: number;
}

/** A message's body, numbered by its type, or a part with its section number. */
type Place = { message: string } | { id: string };

const EMPTY = new Uint8Array(0);

/** A subtree kept as one opaque attachment, past the depth or part limits. */
function opaque(bytes: Uint8Array, partId: string, headers: readonly HeaderField[]): MimePart {
	return {
		partId,
		headers,
		type: 'application/octet-stream',
		params: {},
		disposition: 'attachment',
		name: null,
		cid: null,
		body: bytes,
		parts: [],
		message: null,
	};
}

function readParts(
	bytes: Uint8Array,
	ranges: ReadonlyArray<readonly [number, number]>,
	prefix: string,
	depth: number,
	state: State,
	defaultType: string,
): MimePart[] {
	const parts: MimePart[] = [];
	for (const [index, [start, end]] of ranges.entries()) {
		const partId = `${prefix}${index + 1}`;
		if (state.parts >= state.maxParts) {
			state.parts++;
			parts.push(opaque(bytes.subarray(start, ranges.at(-1)![1]), partId, []));
			break;
		}
		parts.push(
			readEntity(bytes.subarray(start, end), { id: partId }, depth + 1, state, defaultType),
		);
	}
	return parts;
}

function readEntity(
	bytes: Uint8Array,
	place: Place,
	depth: number,
	state: State,
	defaultType: string,
): MimePart {
	state.parts++;
	const { header, bodyOffset } = splitMessage(bytes);
	const headers = parseHeaders(header);
	const body = bytes.subarray(bodyOffset);
	const contentType = parseContentType(getHeader(headers, 'Content-Type'), defaultType);
	const encoding = transferEncoding(getHeader(headers, 'Content-Transfer-Encoding'));
	const disposition = parseContentDisposition(getHeader(headers, 'Content-Disposition'));
	let type = encoding ? `${contentType.type}/${contentType.subtype}` : 'application/octet-stream';
	let split: MultipartSplit | null = null;
	let content = body;
	if (type.startsWith('multipart/')) {
		// A multipart must not be encoded, but some are; a body without its boundary reads as text.
		if (encoding === 'base64' || encoding === 'quoted-printable')
			content = decodeTransfer(body, encoding);
		// A boundary cannot end in a space (RFC 2046), and transports strip one from the lines.
		const boundary = contentType.params.boundary?.trimEnd();
		// No more parts are told apart than the budget leaves: `readParts` keeps the rest whole.
		const budget = Math.max(0, state.maxParts - state.parts);
		const found = boundary ? splitMultipart(content, boundary, budget) : null;
		if (found && (found.parts.length || found.closed)) split = found;
		else type = 'text/plain';
	}
	const partId = 'message' in place ? `${place.message}${split ? 'TEXT' : '1'}` : place.id;
	const part: Omit<MimePart, 'body' | 'parts' | 'message'> = {
		partId,
		headers,
		type,
		params: contentType.params,
		// RFC 2183 section 2.8: an unknown disposition is treated as `attachment`.
		disposition: disposition.type === 'inline' ? 'inline' : disposition.type ? 'attachment' : null,
		name: cleanFileName(disposition.params.filename ?? contentType.params.name),
		cid: parseContentId(getHeader(headers, 'Content-ID')),
	};
	if (split) {
		if (depth >= state.maxDepth) return opaque(bytes, partId, headers);
		const prefix = 'message' in place ? place.message : `${partId}.`;
		const childType = contentType.subtype === 'digest' ? 'message/rfc822' : 'text/plain';
		const parts = readParts(content, split.parts, prefix, depth, state, childType);
		return { ...part, body: EMPTY, parts, message: null };
	}
	const decoded = decodeTransfer(body, encoding);
	const nested =
		(type === 'message/rfc822' || type === 'message/global') &&
		depth < state.maxDepth &&
		state.parts < state.maxParts;
	const message = nested ? readMessage(decoded, `${partId}.`, depth + 1, state) : null;
	return { ...part, body: decoded, parts: [], message };
}

function toAttachment(part: MimePart, index: number): ParsedAttachment {
	const made = part.message
		? emlFileName(part.message.subject)
		: `attachment-${index + 1}.${extensionFor(part.type)}`;
	return {
		partId: part.partId,
		name: part.name ?? made,
		type: part.type,
		size: part.body.length,
		disposition: part.disposition,
		cid: part.cid,
		bytes: part.body,
	};
}

function readMessage(bytes: Uint8Array, prefix: string, depth: number, state: State): ParsedEmail {
	const root = readEntity(bytes, { message: prefix }, depth, state, 'text/plain');
	const header = (name: string): string | undefined => getHeader(root.headers, name);
	const { text, html, htmlParts, attachments } = messageBodies(root);
	return {
		headers: root.headers,
		messageId: parseMessageIds(header('Message-ID')),
		inReplyTo: parseMessageIds(header('In-Reply-To')),
		references: parseMessageIds(header('References')),
		from: parseAddressList(header('From')),
		sender: parseAddressList(header('Sender')),
		to: parseAddressList(header('To')),
		cc: parseAddressList(header('Cc')),
		bcc: parseAddressList(header('Bcc')),
		replyTo: parseAddressList(header('Reply-To')),
		subject: decodeEncodedWords(header('Subject') ?? ''),
		sentAt: parseDate(header('Date')),
		text,
		html,
		htmlParts,
		attachments: attachments.map(toAttachment),
		root,
		size: bytes.length,
	};
}

/**
 * `readEmail` without its safety net: an internal error is thrown instead of being turned into a
 * best-effort result, for tests and callers that want to see one.
 */
export function parseEmail(raw: Uint8Array | string, options: ReadOptions = {}): ParsedEmail {
	const bytes = typeof raw === 'string' ? utf8(raw) : plainBytes(raw);
	const state: State = {
		parts: 0,
		maxParts: Math.max(1, options.maxParts ?? 1000),
		maxDepth: Math.max(0, options.maxDepth ?? 20),
	};
	return readMessage(bytes, '', 0, state);
}

/**
 * Reads a raw RFC 5322 message (an `.eml` file; a string is read as UTF-8 text). Headers are
 * decoded (RFC 2047, RFC 2231, RFC 6532), bodies are decoded from their transfer encoding and
 * charset, and the text, HTML and attachments are sorted out as RFC 8621 does. Malformed input
 * never throws: missing boundaries, truncated base64, unknown charsets and missing bodies are read
 * as far as they go, and past `maxDepth` or `maxParts` the rest is kept as one opaque attachment.
 * Bodies that had no transfer encoding are views of `raw`'s memory, not copies.
 */
export function readEmail(raw: Uint8Array | string, options: ReadOptions = {}): ParsedEmail {
	try {
		return parseEmail(raw, options);
	} catch {
		// Defence in depth for untrusted input: show the raw text rather than fail the caller.
		const bytes = typeof raw === 'string' ? utf8(raw) : plainBytes(raw);
		const root: MimePart = {
			partId: '1',
			headers: [],
			type: 'text/plain',
			params: {},
			disposition: null,
			name: null,
			cid: null,
			body: bytes,
			parts: [],
			message: null,
		};
		return {
			headers: [],
			messageId: [],
			inReplyTo: [],
			references: [],
			from: [],
			sender: [],
			to: [],
			cc: [],
			bcc: [],
			replyTo: [],
			subject: '',
			sentAt: undefined,
			text: decodeUnlabelled(bytes),
			html: null,
			htmlParts: null,
			attachments: [],
			root,
			size: bytes.length,
		};
	}
}
