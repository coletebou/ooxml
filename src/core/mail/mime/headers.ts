// Header fields (RFC 5322 section 2.2): splitting a message or body part into its header block and
// body, unfolding and reading the fields, and folding them for output. New code.
import { CR, LF, isAscii, toBinary } from './binary';
import { decodeUnlabelled } from './charset';
import { trimBlanks } from './syntax';

/** One header field: the name as written, the value unfolded and trimmed but not decoded. */
export interface HeaderField {
	name: string;
	value: string;
}

export interface MessageSplit {
	/**
	 * The header block as text, without the blank line that ends it: UTF-8 where it is valid
	 * (RFC 6532), each other line read as windows-1252.
	 */
	header: string;
	/** Where the body starts in the bytes; their length when there is no body. */
	bodyOffset: number;
}

const SP = 0x20;
const HT = 0x09;
const COLON = 0x3a;
const SOFT_LIMIT = 78;
const HARD_LIMIT = 998;
const MBOX_FROM = [0x46, 0x72, 0x6f, 0x6d, 0x20];

/** True when the line from `start` to `end` begins with a field name and a colon. */
function isFieldLine(bytes: Uint8Array, start: number, end: number): boolean {
	let i = start;
	while (i < end && bytes[i]! > SP && bytes[i]! < 0x7f && bytes[i] !== COLON) i++;
	if (i === start) return false;
	while (i < end && (bytes[i] === SP || bytes[i] === HT)) i++;
	return bytes[i] === COLON;
}

function decodeHeaderBlock(bytes: Uint8Array): string {
	if (isAscii(bytes)) return toBinary(bytes);
	const lines: string[] = [];
	let start = 0;
	while (start <= bytes.length) {
		const end = bytes.indexOf(LF, start);
		lines.push(decodeUnlabelled(bytes.subarray(start, end < 0 ? bytes.length : end)));
		if (end < 0) break;
		start = end + 1;
	}
	return lines.join('\n');
}

/**
 * Splits a message (or a body part) into its header block and body. The block ends at the first
 * empty line, CRLF or a bare LF; a line that is neither a field nor a folded continuation (a
 * message with no blank line before its body) starts the body instead, and so does the end of the
 * input. A leading mbox `From ` line, which `.eml` files saved from mbox keep, is skipped.
 */
export function splitMessage(bytes: Uint8Array): MessageSplit {
	const firstLine = bytes.indexOf(LF) + 1 || bytes.length;
	// `From  : Ada` (white space before the colon, RFC 5322 A.6.3) is a field, not mbox.
	const mbox = MBOX_FROM.every((byte, i) => bytes[i] === byte) && !isFieldLine(bytes, 0, firstLine);
	const start = mbox ? firstLine : 0;
	const split = (end: number, bodyOffset: number): MessageSplit => ({
		header: decodeHeaderBlock(bytes.subarray(start, end)),
		bodyOffset,
	});
	let inField = false;
	for (let pos = start; pos < bytes.length;) {
		const lineEnd = bytes.indexOf(LF, pos);
		const next = lineEnd < 0 ? bytes.length : lineEnd + 1;
		let end = lineEnd < 0 ? bytes.length : lineEnd;
		if (end > pos && bytes[end - 1] === CR) end--;
		const folded = bytes[pos] === SP || bytes[pos] === HT;
		// A line of white space before any field is taken for the blank line some programs write.
		if (end === pos || (folded && !inField && isBlankLine(bytes, pos, end)))
			return split(pos, next);
		if (folded ? !inField : !isFieldLine(bytes, pos, end)) return split(pos, pos);
		inField = true;
		pos = next;
	}
	return split(bytes.length, bytes.length);
}

function isBlankLine(bytes: Uint8Array, start: number, end: number): boolean {
	for (let i = start; i < end; i++) if (bytes[i] !== SP && bytes[i] !== HT) return false;
	return true;
}

/**
 * The fields of a header block, in order and with duplicates. Folded lines are unfolded by
 * removing the line breaks only (RFC 5322 section 2.2.3); the obsolete white space before the
 * colon is accepted, lines that are not fields are skipped, and an empty line ends the block.
 */
export function parseHeaders(text: string): HeaderField[] {
	const fields: HeaderField[] = [];
	let current: HeaderField | null = null;
	for (const raw of text.split('\n')) {
		const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
		if (line === '') break;
		if (line[0] === ' ' || line[0] === '\t') {
			if (current) current.value += line;
			continue;
		}
		const match = /^([!-9;-~]+)[ \t]*:(.*)$/.exec(line);
		current = match ? { name: match[1]!, value: match[2]! } : null;
		if (current) fields.push(current);
	}
	for (const field of fields) field.value = trimBlanks(field.value);
	return fields;
}

/** Every value of the fields called `name` (case-insensitive), in order. */
export function getHeaders(fields: readonly HeaderField[], name: string): string[] {
	const key = name.toLowerCase();
	return fields.filter((field) => field.name.toLowerCase() === key).map((field) => field.value);
}

/**
 * The value of the last field called `name` (case-insensitive), as RFC 8621 reads its header
 * properties, or `undefined` when there is none.
 */
export function getHeader(fields: readonly HeaderField[], name: string): string | undefined {
	const key = name.toLowerCase();
	for (let i = fields.length - 1; i >= 0; i--)
		if (fields[i]!.name.toLowerCase() === key) return fields[i]!.value;
	return undefined;
}

function hardWrap(line: string): string[] {
	if (line.length <= HARD_LIMIT) return [line];
	const out = [line.slice(0, HARD_LIMIT)];
	for (let i = HARD_LIMIT; i < line.length; i += HARD_LIMIT - 1)
		out.push(` ${line.slice(i, i + HARD_LIMIT - 1)}`);
	return out;
}

/**
 * `Name: value` folded for output, lines joined by CRLF without a final one. Folds go before white
 * space, so unfolding gives the value back, and keep lines within 78 characters where a space
 * allows (never inside a word, so never inside an encoded word). Line breaks in `value` become
 * spaces, so a value can never end the field early; a word longer than the 998-character limit is
 * cut, the one case that changes the value.
 */
export function foldHeader(name: string, value: string): string {
	const body = trimBlanks(value.replace(/\r\n|\r|\n/g, ' '));
	const lines: string[] = [];
	let line = `${name}:`;
	for (const [index, token] of (body.match(/[ \t]*[^ \t]+/g) ?? []).entries()) {
		const piece = index === 0 ? ` ${token}` : token;
		if (index > 0 && line.length + piece.length > SOFT_LIMIT) {
			lines.push(line);
			line = piece;
		} else line += piece;
	}
	lines.push(line);
	return lines.flatMap(hardWrap).join('\r\n');
}
