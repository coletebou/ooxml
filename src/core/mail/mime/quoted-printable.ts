// Quoted-printable (RFC 2045 section 6.7) for bodies, and its header form, the `Q` encoding of
// RFC 2047 section 4.2. New code.
import { CR, LF, fromBinary } from './binary';

const HEX = '0123456789ABCDEF';
const EQUALS = 0x3d;
const SPACE = 0x20;
const TAB = 0x09;
const UNDERSCORE = 0x5f;
const MAX_LINE = 76;

function hexValue(code: number | undefined): number {
	if (code === undefined) return -1;
	if (code >= 0x30 && code <= 0x39) return code - 0x30;
	if (code >= 0x41 && code <= 0x46) return code - 0x37;
	if (code >= 0x61 && code <= 0x66) return code - 0x57;
	return -1;
}

const isBlank = (code: number | undefined): boolean => code === SPACE || code === TAB;

/** The index after a line break starting at `i` (CRLF or a bare LF), or -1 when there is none. */
function lineBreakEnd(input: Uint8Array, i: number): number {
	if (input[i] === LF) return i + 1;
	if (input[i] === CR && input[i + 1] === LF) return i + 2;
	return -1;
}

/**
 * Decodes quoted-printable to bytes. Soft line breaks (`=` at the end of a line, even with white
 * space after it, and a final `=`) are removed, unencoded white space at the end of a line is
 * dropped as transport padding (rule 3), and an `=` that starts no valid escape is kept as
 * written. Lower-case hex digits are accepted. In `header` mode (RFC 2047 `Q`) `_` is a space.
 * A string is read one character per byte (a binary string).
 */
export function decodeQuotedPrintable(
	text: string | Uint8Array,
	options: { header?: boolean } = {},
): Uint8Array {
	const input = typeof text === 'string' ? fromBinary(text) : text;
	const out = new Uint8Array(input.length);
	let length = 0;
	let i = 0;
	while (i < input.length) {
		const byte = input[i]!;
		if (byte === EQUALS) {
			const high = hexValue(input[i + 1]);
			const low = hexValue(input[i + 2]);
			if (high >= 0 && low >= 0) {
				out[length++] = (high << 4) | low;
				i += 3;
				continue;
			}
			let j = i + 1;
			while (isBlank(input[j])) j++;
			const soft = j >= input.length ? j : lineBreakEnd(input, j);
			if (soft >= 0) {
				i = soft;
				continue;
			}
			out[length++] = byte;
			i++;
			continue;
		}
		if (isBlank(byte) && !options.header) {
			let j = i;
			while (isBlank(input[j])) j++;
			if (lineBreakEnd(input, j) >= 0) {
				i = j;
				continue;
			}
			while (i < j) out[length++] = input[i++]!;
			continue;
		}
		out[length++] = options.header && byte === UNDERSCORE ? SPACE : byte;
		i++;
	}
	return out.slice(0, length);
}

const escape = (byte: number): string => `=${HEX[byte >> 4]}${HEX[byte & 15]}`;

/**
 * Encodes bytes as quoted-printable in lines of at most 76 characters. A CRLF pair is a hard line
 * break; a lone CR or LF, `=`, control and 8-bit bytes are escaped, and so is white space at the
 * end of a line, which a transport could strip. Decoding the result gives back the same bytes.
 */
export function encodeQuotedPrintable(bytes: Uint8Array): string {
	const lines: string[] = [];
	let line = '';
	for (let i = 0; i < bytes.length; i++) {
		const byte = bytes[i]!;
		if (byte === CR && bytes[i + 1] === LF) {
			lines.push(line, '\r\n');
			line = '';
			i++;
			continue;
		}
		const atLineEnd = i + 1 >= bytes.length || (bytes[i + 1] === CR && bytes[i + 2] === LF);
		const literal =
			(byte >= 0x21 && byte <= 0x7e && byte !== EQUALS) || (isBlank(byte) && !atLineEnd);
		const token = literal ? String.fromCharCode(byte) : escape(byte);
		if (line.length + token.length > MAX_LINE - 1) {
			lines.push(line, '=\r\n');
			line = '';
		}
		line += token;
	}
	lines.push(line);
	return lines.join('');
}
