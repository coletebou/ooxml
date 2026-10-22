// Multipart bodies (RFC 2046 section 5.1.1): the body parts between the boundary delimiter lines.
// New code.
import { CR, LF, utf8 } from './binary';

export interface MultipartSplit {
	/** Start and end of each body part; the line break before a delimiter belongs to the delimiter. */
	parts: Array<readonly [number, number]>;
	/** False when the close delimiter is missing, so the last part runs to the end. */
	closed: boolean;
}

const DASH = 0x2d;

/**
 * Whether the line from `start` to `end` is `--boundary` (`open`) or `--boundary--` (`close`),
 * either followed only by white space (transport padding), or neither.
 */
function delimiter(
	bytes: Uint8Array,
	start: number,
	end: number,
	marker: Uint8Array,
): 'open' | 'close' | null {
	if (end - start < marker.length || bytes[start] !== DASH || bytes[start + 1] !== DASH)
		return null;
	for (let i = 2; i < marker.length; i++) if (bytes[start + i] !== marker[i]) return null;
	let i = start + marker.length;
	const close = i + 1 < end && bytes[i] === DASH && bytes[i + 1] === DASH;
	if (close) i += 2;
	for (; i < end; i++) if (bytes[i] !== 0x20 && bytes[i] !== 0x09 && bytes[i] !== CR) return null;
	return close ? 'close' : 'open';
}

/** The end of a part whose next line starts at `line`: before the CRLF or LF that ends it. */
function partEnd(bytes: Uint8Array, start: number, line: number): number {
	if (line - 2 >= start && bytes[line - 2] === CR && bytes[line - 1] === LF) return line - 2;
	if (line - 1 >= start && bytes[line - 1] === LF) return line - 1;
	return line;
}

/**
 * The body parts of a multipart body. The preamble before the first delimiter and the epilogue
 * after the close delimiter are dropped; a missing close delimiter ends the last part at the end
 * of the body. No delimiter at all gives no parts. Past `limit` parts the rest come back as one
 * range, from the start of the first of them to the end of the last, so a body of millions of
 * tiny parts costs no more than `limit` ranges.
 */
export function splitMultipart(
	bytes: Uint8Array,
	boundary: string,
	limit = Number.POSITIVE_INFINITY,
): MultipartSplit {
	const marker = utf8(`--${boundary}`);
	const parts: Array<readonly [number, number]> = [];
	/** The parts past `limit`: where the first starts and the last ends. */
	let rest: [number, number] | null = null;
	const add = (from: number, to: number): void => {
		if (parts.length < limit) parts.push([from, to]);
		else if (rest) rest[1] = to;
		else rest = [from, to];
	};
	const split = (closed: boolean): MultipartSplit => ({
		parts: rest ? [...parts, rest] : parts,
		closed,
	});
	let start = -1;
	for (let line = 0; line < bytes.length;) {
		const lineEnd = bytes.indexOf(LF, line);
		const end = lineEnd < 0 ? bytes.length : lineEnd;
		const kind = delimiter(bytes, line, end, marker);
		if (kind) {
			if (start >= 0) add(start, partEnd(bytes, start, line));
			if (kind === 'close') return split(true);
			start = lineEnd < 0 ? bytes.length : lineEnd + 1;
		}
		if (lineEnd < 0) break;
		line = lineEnd + 1;
	}
	if (start >= 0 && start < bytes.length) add(start, bytes.length);
	return split(false);
}
