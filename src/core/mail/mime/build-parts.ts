// The body parts of an outgoing message: text and HTML in the lightest safe transfer encoding,
// base64 attachments, and multipart containers whose boundaries cannot occur in what they hold.
// New code.
import { formatMessageIds } from './addresses';
import { CR, LF, toBinary, utf8 } from './binary';
import { foldHeader } from './headers';
import { formatParameters, parseContentType } from './parameters';
import { encodeQuotedPrintable } from './quoted-printable';
import { encodeBase64Lines } from './transfer';

export interface OutgoingAttachment {
	name: string;
	/** The media type; parameters it carries, such as `charset`, are kept. */
	type: string;
	bytes: Uint8Array;
	/** `Content-ID` without angle brackets, for `cid:` references from the HTML body. */
	cid?: string;
	/** Shown in the body rather than listed (`Content-Disposition: inline`). */
	inline?: boolean;
}

/** A finished part: its folded header lines and its encoded body. */
export interface RenderedPart {
	headers: string[];
	body: string;
}

export interface MultipartNode {
	subtype: 'mixed' | 'alternative' | 'related';
	params?: Record<string, string>;
	parts: PartNode[];
}

export type PartNode = RenderedPart | MultipartNode;

/** Hands out boundaries in the order the multiparts are written (outermost first). */
export interface BoundarySource {
	next: number;
	pick(index: number, contents: readonly string[]): string;
}

const MAX_7BIT_TEXT_LINE = 76;
const MAX_LINE = 998;
/** RFC 2046 section 5.1.1 `boundary`: 1 to 70 `bchars`, not ending in a space. */
const BOUNDARY = /^[0-9A-Za-z'()+_,\-./:=? ]{0,69}[0-9A-Za-z'()+_,\-./:=?]$/;

const isBlank = (byte: number | undefined): boolean => byte === 0x20 || byte === 0x09;

/** Printable ASCII and tabs in CRLF lines of at most 76 characters with no white space at the end. */
function isPlainText(bytes: Uint8Array): boolean {
	let column = 0;
	for (let i = 0; i < bytes.length; i++) {
		const byte = bytes[i]!;
		if (byte === CR && bytes[i + 1] === LF) {
			if (isBlank(bytes[i - 1])) return false;
			column = 0;
			i++;
		} else if ((byte < 0x20 && byte !== 0x09) || byte > 0x7e || ++column > MAX_7BIT_TEXT_LINE)
			return false;
	}
	return !isBlank(bytes[bytes.length - 1]);
}

/** RFC 2045 `7bit` data: no NUL or 8-bit bytes, CR and LF only as CRLF, lines of 998 or fewer. */
function isSevenBit(bytes: Uint8Array): boolean {
	let column = 0;
	for (let i = 0; i < bytes.length; i++) {
		const byte = bytes[i]!;
		if (byte === CR && bytes[i + 1] === LF) {
			column = 0;
			i++;
		} else if (byte === 0 || byte === CR || byte === LF || byte > 0x7f || ++column > MAX_LINE)
			return false;
	}
	return true;
}

/** A UTF-8 text or HTML part: `7bit` when it already is, else quoted-printable. */
export function textPart(text: string, subtype: 'plain' | 'html'): RenderedPart {
	const bytes = utf8(text.replace(/\r\n|\r|\n/g, '\r\n'));
	const plain = isPlainText(bytes);
	return {
		headers: [
			`Content-Type: text/${subtype}; charset=utf-8`,
			`Content-Transfer-Encoding: ${plain ? '7bit' : 'quoted-printable'}`,
		],
		body: plain ? toBinary(bytes) : encodeQuotedPrintable(bytes),
	};
}

/**
 * An attachment in base64 with its name in `Content-Type` and `Content-Disposition` (RFC 2231 when
 * it is not ASCII). A `message/rfc822` that is 7-bit data is written as it is, since RFC 2046
 * section 5.2.1 allows no other encoding for it; any other attached message falls back to base64,
 * which readers accept.
 */
export function attachmentPart(
	attachment: OutgoingAttachment,
	disposition: 'inline' | 'attachment',
): RenderedPart {
	const media = parseContentType(attachment.type, 'application/octet-stream');
	// A file cannot be a multipart: it has no boundary, and a reader would look for its parts.
	const type =
		media.type === 'multipart' ? 'application/octet-stream' : `${media.type}/${media.subtype}`;
	const params = Object.fromEntries(Object.entries(media.params).filter(([key]) => key !== 'name'));
	const named = (key: string): Record<string, string> =>
		attachment.name ? { [key]: attachment.name } : {};
	const headers = [
		foldHeader('Content-Type', `${type}${formatParameters({ ...params, ...named('name') })}`),
		foldHeader('Content-Disposition', `${disposition}${formatParameters(named('filename'))}`),
	];
	if (attachment.cid) headers.push(foldHeader('Content-ID', formatMessageIds([attachment.cid])));
	const verbatim = type === 'message/rfc822' && isSevenBit(attachment.bytes);
	headers.push(`Content-Transfer-Encoding: ${verbatim ? '7bit' : 'base64'}`);
	return {
		headers,
		body: verbatim ? toBinary(attachment.bytes) : encodeBase64Lines(attachment.bytes),
	};
}

/** Random hex digits: `crypto.getRandomValues` where the runtime has it, else `Math.random`. */
export function randomHex(bytes: number): string {
	const values = new Uint8Array(bytes);
	const source = (globalThis as { crypto?: Pick<Crypto, 'getRandomValues'> }).crypto;
	if (typeof source?.getRandomValues === 'function') source.getRandomValues(values);
	else for (let i = 0; i < bytes; i++) values[i] = Math.floor(Math.random() * 256);
	return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('');
}

/**
 * Boundaries from `custom(index)` (deterministic, for tests) or random ones. A boundary that
 * occurs in the content it would delimit is replaced: a numbered variant of the custom one, or a
 * new random one. Throws a `RangeError` for a custom boundary RFC 2046 does not allow.
 */
export function boundaries(custom?: (index: number) => string): BoundarySource {
	return {
		next: 0,
		pick(index, contents) {
			const base = custom ? custom(index) : `=_${index}_${randomHex(12)}`;
			if (!BOUNDARY.test(base)) throw new RangeError(`Invalid MIME boundary: ${base}`);
			let boundary = base;
			for (
				let attempt = 1;
				contents.some((content) => content.includes(`--${boundary}`));
				attempt++
			)
				boundary = custom ? `${base}.${attempt}` : `=_${index}_${randomHex(12)}`;
			return boundary;
		},
	};
}

export const serializePart = (part: RenderedPart): string =>
	`${part.headers.join('\r\n')}\r\n\r\n${part.body}`;

/** Renders a part tree, picking each multipart's boundary once its content is known. */
export function renderPart(node: PartNode, source: BoundarySource): RenderedPart {
	if (!('subtype' in node)) return node;
	const index = source.next++;
	const children = node.parts.map((child) => serializePart(renderPart(child, source)));
	const boundary = source.pick(index, children);
	const params = formatParameters({ boundary, ...node.params });
	return {
		headers: [foldHeader('Content-Type', `multipart/${node.subtype}${params}`)],
		body: `--${boundary}\r\n${children.join(`\r\n--${boundary}\r\n`)}\r\n--${boundary}--`,
	};
}
