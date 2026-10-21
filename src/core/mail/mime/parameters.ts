// MIME parameters: `Content-Type` (RFC 2045 section 5) and `Content-Disposition` (RFC 2183) with
// their `attribute=value` lists, RFC 2231 continuations and charsets, and the encoded words many
// mail programs put inside a quoted `name` or `filename`. New code.
import { concatBytes, utf8 } from './binary';
import { decodeCharset } from './charset';
import { decodeEncodedWords, looksEncoded } from './encoded-words';
import { quoteString, stripComments } from './syntax';

export interface ContentType {
	/** Lower case, `text`. */
	type: string;
	/** Lower case, `plain`. */
	subtype: string;
	/** Parameter names in lower case; values decoded, RFC 2231 pieces joined under their name. */
	params: Record<string, string>;
}

export interface ContentDisposition {
	/** Lower case `inline`, `attachment` or another value; empty when the field is missing. */
	type: string;
	params: Record<string, string>;
}

interface RawParameter {
	name: string;
	value: string;
}

interface Segment {
	index: number;
	value: string;
	encoded: boolean;
}

const TOKEN_CHARS = "!#$%&'*+\\-.^_`|~0-9A-Za-z";
const TOKEN = new RegExp(`^[${TOKEN_CHARS}]+$`);
const MEDIA_TYPE = new RegExp(`^([${TOKEN_CHARS}]+)/([${TOKEN_CHARS}]+)$`);
/** White space followed by `name=`: the next parameter, when a writer forgot the semicolon. */
const NEXT_PARAMETER = new RegExp(`[ \\t]+[${TOKEN_CHARS}]+[ \\t]*=`, 'y');
/** RFC 2231 `attribute-char`: what an extended value carries without percent-encoding. */
const ATTRIBUTE_CHAR = /^[!#$&+\-.^_`|~0-9A-Za-z]$/;
const FILE_NAMES = new Set(['name', 'filename']);
/** What a media type without a subtype most likely meant. */
const LONE_TYPES: Readonly<Record<string, string>> = {
	text: 'text/plain',
	multipart: 'multipart/mixed',
	message: 'message/rfc822',
};

/** The index of the first `;` outside quoted strings and comments, else the length. */
function headEnd(text: string): number {
	let depth = 0;
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char === '\\' && (quoted || depth > 0)) i++;
		else if (quoted) quoted = char !== '"';
		else if (depth > 0) depth += char === '(' ? 1 : char === ')' ? -1 : 0;
		else if (char === '"') quoted = true;
		else if (char === '(') depth = 1;
		else if (char === ';') return i;
	}
	return text.length;
}

/**
 * A quoted value from the `"` at `start`. Only `\\` and `\"` are unescaped, since Windows paths are
 * often written with bare backslashes; an unterminated string runs to the end.
 */
function readQuoted(text: string, start: number): [string, number] {
	let out = '';
	for (let i = start + 1; i < text.length; i++) {
		const char = text[i]!;
		if (char === '"') return [out, i + 1];
		if (char === '\\' && (text[i + 1] === '"' || text[i + 1] === '\\')) out += text[++i];
		else out += char;
	}
	return [out, text.length];
}

function bareEnd(text: string, start: number): number {
	for (let i = start; i < text.length; i++) {
		const char = text[i];
		if (char === ';') return i;
		if (char !== ' ' && char !== '\t') continue;
		NEXT_PARAMETER.lastIndex = i;
		if (NEXT_PARAMETER.test(text)) return i;
		// Tried once per run of white space, so the whole scan stays linear.
		while (text[i + 1] === ' ' || text[i + 1] === '\t') i++;
	}
	return text.length;
}

function readParameters(text: string): RawParameter[] {
	const out: RawParameter[] = [];
	let i = 0;
	while (i < text.length) {
		if (/[;\s]/.test(text[i]!)) {
			i++;
			continue;
		}
		let end = i;
		while (end < text.length && text[end] !== '=' && text[end] !== ';') end++;
		const name = stripComments(text.slice(i, end)).trim().toLowerCase();
		i = end;
		if (text[i] !== '=') continue;
		i++;
		while (text[i] === ' ' || text[i] === '\t') i++;
		let value: string;
		if (text[i] === '"') {
			[value, i] = readQuoted(text, i);
			while (i < text.length && text[i] !== ';') i++;
		} else {
			const stop = bareEnd(text, i);
			// Unquoted file names keep their parentheses: `report (1).pdf` is common, a comment is not.
			value = text.slice(i, stop);
			value = (FILE_NAMES.has(name) ? value : stripComments(value)).trim();
			i = stop;
		}
		if (TOKEN.test(name)) out.push({ name, value });
	}
	return out;
}

/** `%XX` escapes as bytes; any other text as its UTF-8. */
function percentDecode(text: string): Uint8Array {
	const chunks: Uint8Array[] = [];
	for (const [piece, hex] of text.matchAll(/%([0-9A-Fa-f]{2})|[^%]+|%/g))
		chunks.push(hex ? Uint8Array.of(Number.parseInt(hex, 16)) : utf8(piece));
	return concatBytes(chunks);
}

function decodeSegments(segments: readonly Segment[]): string {
	let charset = '';
	const chunks = segments.map((segment, position) => {
		let text = segment.value;
		if (segment.encoded && position === 0) {
			const match = /^([^']*)'[^']*'([\s\S]*)$/.exec(text);
			if (match) {
				charset = match[1]!;
				text = match[2]!;
			}
		}
		return segment.encoded ? percentDecode(text) : utf8(text);
	});
	return decodeCharset(concatBytes(chunks), charset);
}

/** Joins RFC 2231 pieces (`name*0*=`, `name*1=`, `name*=`), which win over a plain `name=`. */
function combine(raw: readonly RawParameter[]): Record<string, string> {
	const plain = new Map<string, string>();
	const extended = new Map<string, Map<number, Segment>>();
	for (const { name, value } of raw) {
		const match = /^([^*]+)\*(?:(\d{1,3})(\*)?)?$/.exec(name);
		if (!match) {
			if (!plain.has(name)) plain.set(name, value);
			continue;
		}
		const index = match[2] === undefined ? 0 : Number(match[2]);
		const segments = extended.get(match[1]!) ?? new Map<number, Segment>();
		if (!segments.has(index))
			segments.set(index, { index, value, encoded: match[2] === undefined || match[3] === '*' });
		extended.set(match[1]!, segments);
	}
	const params: Record<string, string> = {};
	for (const [name, value] of plain)
		if (name !== '__proto__')
			params[name] = FILE_NAMES.has(name) ? decodeEncodedWords(value) : value;
	for (const [name, segments] of extended) {
		const ordered = [...segments.values()].sort((a, b) => a.index - b.index);
		if (name !== '__proto__') params[name] = decodeSegments(ordered);
	}
	return params;
}

/** Splits `value; params` into the leading word and the parameters, tolerating a missing `;`. */
function split(value: string): { head: string; params: Record<string, string> } {
	const end = headEnd(value);
	// White space is collapsed first: `\s*\/\s*` alone backtracks over long runs of it.
	const words = stripComments(value.slice(0, end))
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/ ?\/ ?/, '/')
		.split(' ');
	const rest = `${words.slice(1).join(' ')}${value.slice(end)}`;
	return { head: (words[0] ?? '').toLowerCase(), params: combine(readParameters(rest)) };
}

/**
 * Reads a `Content-Type` value. A missing or unreadable one is `fallback` (RFC 2045 section 5.2:
 * `text/plain; charset=us-ascii`, or `message/rfc822` inside `multipart/digest`), keeping any
 * parameters that could be read; a type without a subtype is read as what it most likely meant.
 */
export function parseContentType(value: string | undefined, fallback = 'text/plain'): ContentType {
	const { head, params } = split(value ?? '');
	const lone = Object.hasOwn(LONE_TYPES, head) ? LONE_TYPES[head]! : '';
	const media = MEDIA_TYPE.exec(head) ?? MEDIA_TYPE.exec(lone);
	if (media) return { type: media[1]!, subtype: media[2]!, params };
	const known = MEDIA_TYPE.exec(head ? 'application/octet-stream' : fallback.toLowerCase());
	const type = known?.[1] ?? 'text';
	const subtype = known?.[2] ?? 'plain';
	return {
		type,
		subtype,
		params:
			type === 'text' && params.charset === undefined ? { ...params, charset: 'us-ascii' } : params,
	};
}

/** Reads a `Content-Disposition` value (RFC 2183); the type is empty when `value` is missing. */
export function parseContentDisposition(value: string | undefined): ContentDisposition {
	const { head, params } = split(value ?? '');
	return { type: head, params };
}

function percentEncode(char: string): string {
	if (ATTRIBUTE_CHAR.test(char)) return char;
	let out = '';
	for (const byte of utf8(char)) out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
	return out;
}

function formatParameter(name: string, value: string): string {
	// What a value may take so that ` name*12*=value;` still fits a folded 78-character line.
	const room = Math.max(24, 70 - name.length);
	// A quoted file name that looks like an encoded word would be decoded by readers (and here).
	if (/^[\x20-\x7e]*$/.test(value) && !(FILE_NAMES.has(name) && looksEncoded(value))) {
		if (value.length + 2 <= room)
			return TOKEN.test(value) ? `${name}=${value}` : `${name}=${quoteString(value)}`;
		const pieces = value.match(new RegExp(`[\\s\\S]{1,${room - 4}}`, 'g')) ?? [];
		return pieces.map((piece, index) => `${name}*${index}=${quoteString(piece)}`).join('; ');
	}
	const encoded = Array.from(value, percentEncode);
	const prefix = "utf-8''";
	if (prefix.length + encoded.join('').length <= room)
		return `${name}*=${prefix}${encoded.join('')}`;
	const segments: string[] = [];
	let current = prefix;
	for (const piece of encoded) {
		if (current !== prefix && current.length + piece.length > room) {
			segments.push(current);
			current = '';
		}
		current += piece;
	}
	segments.push(current);
	return segments.map((segment, index) => `${name}*${index}*=${segment}`).join('; ');
}

/**
 * `; name=value` for each parameter, ready to follow a media type or disposition. Tokens are written
 * bare and other printable ASCII quoted; non-ASCII and control characters use the RFC 2231
 * `name*=utf-8''...` form, and values too long for one line are split into RFC 2231 continuations,
 * so a folded field stays within 78 characters.
 */
export function formatParameters(params: Readonly<Record<string, string>>): string {
	let out = '';
	for (const [name, value] of Object.entries(params)) {
		const key = name.toLowerCase();
		if (TOKEN.test(key) && !key.includes('*')) out += `; ${formatParameter(key, value)}`;
	}
	return out;
}
