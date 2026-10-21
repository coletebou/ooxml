// Content-Transfer-Encoding (RFC 2045 section 6): reading the field, decoding bodies leniently and
// writing base64 in mail-sized lines. New code.
import { decodeBase64, encodeBase64 } from '../../digest/base64';
import { concatBytes, toBinary } from './binary';
import { decodeQuotedPrintable } from './quoted-printable';
import { stripComments } from './syntax';

export type TransferEncoding = '7bit' | '8bit' | 'binary' | 'quoted-printable' | 'base64';

const IDENTITY = new Set(['', '7bit', '8bit', 'binary', '7-bit', '8-bit']);

/**
 * The encoding a `Content-Transfer-Encoding` value names (`7bit` when it is missing), or `null` for
 * one this codec cannot decode, whose part RFC 2045 section 6.4 says to treat as
 * `application/octet-stream`.
 */
export function transferEncoding(value: string | undefined): TransferEncoding | null {
	const name = stripComments(value ?? '')
		.trim()
		.replace(/^["']|["']$/g, '')
		.toLowerCase();
	if (IDENTITY.has(name))
		return name.startsWith('8') ? '8bit' : name === 'binary' ? 'binary' : '7bit';
	if (name === 'quoted-printable' || name === 'base64') return name;
	return null;
}

/**
 * Base64 the way mail programs get it wrong too: a cut-off end, stray characters, and padding in
 * the middle (lines encoded one by one) are decoded as far as they go, never thrown.
 */
export function decodeBase64Body(bytes: Uint8Array): Uint8Array {
	const text = toBinary(bytes);
	const strict = decodeBase64(text);
	if (strict) return strict;
	const chunks: Uint8Array[] = [];
	for (const piece of text.replace(/[^A-Za-z0-9+/=]+/g, '').split(/=+/)) {
		const usable = piece.length % 4 === 1 ? piece.length - 1 : piece.length;
		const decoded = usable ? decodeBase64(piece.slice(0, usable)) : undefined;
		if (decoded) chunks.push(decoded);
	}
	return concatBytes(chunks);
}

/**
 * The body without its transfer encoding: a new array for base64 and quoted-printable, and `bytes`
 * itself for the identity encodings. Not copying is what keeps attached messages, which nest, from
 * multiplying the memory a message takes.
 */
export function decodeTransfer(bytes: Uint8Array, encoding: TransferEncoding | null): Uint8Array {
	if (encoding === 'base64') return decodeBase64Body(bytes);
	if (encoding === 'quoted-printable') return decodeQuotedPrintable(bytes);
	return bytes;
}

/** Base64 in lines of 76 characters joined by CRLF (RFC 2045 section 6.8). */
export function encodeBase64Lines(bytes: Uint8Array): string {
	const text = encodeBase64(bytes);
	const lines: string[] = [];
	for (let i = 0; i < text.length; i += 76) lines.push(text.slice(i, i + 76));
	return lines.join('\r\n');
}
