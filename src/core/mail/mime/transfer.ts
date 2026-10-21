// Content-Transfer-Encoding (RFC 2045 section 6): reading the field, decoding bodies leniently and
// writing base64 in mail-sized lines. New code.
import { encodeBase64 } from '../../digest/base64';
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

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** The value of each byte that is a base64 digit, -1 for any other. */
const DIGITS = new Int8Array(256).fill(-1);
for (let value = 0; value < ALPHABET.length; value++) DIGITS[ALPHABET.charCodeAt(value)] = value;
const PAD = 0x3d;

/**
 * Base64 the way mail programs get it wrong too: a cut-off end, stray characters, and padding in
 * the middle (lines encoded one by one) are decoded as far as they go, never thrown. One pass into
 * one array, so a body padded after every few digits costs no more memory than any other of its
 * size.
 */
export function decodeBase64Body(bytes: Uint8Array): Uint8Array {
	const out = new Uint8Array(Math.floor((bytes.length * 3) / 4));
	let length = 0;
	let buffer = 0;
	let bits = 0;
	for (let i = 0; i < bytes.length; i++) {
		const byte = bytes[i]!;
		const value = DIGITS[byte]!;
		if (value >= 0) {
			buffer = ((buffer << 6) | value) & 0xffffff;
			bits += 6;
			if (bits < 8) continue;
			bits -= 8;
			out[length++] = (buffer >> bits) & 0xff;
		} else if (byte === PAD) {
			// Padding ends a piece: bits short of a byte are dropped, as at a cut-off end.
			buffer = 0;
			bits = 0;
		}
	}
	return length === out.length ? out : out.slice(0, length);
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
