// RFC 2047 encoded words: decoding `=?charset?B|Q?text?=` (with the RFC 2231 section 5 language
// suffix) in header text, and writing text and display names as UTF-8 encoded words. New code.
import { decodeBase64, encodeBase64 } from '../../digest/base64';
import { concatBytes, utf8 } from './binary';
import { decodeCharset, normalizeCharset } from './charset';
import { decodeQuotedPrintable } from './quoted-printable';
import { PLAIN_PHRASE, quoteString } from './syntax';

const ENCODED_WORD = /=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g;
const LOOKS_ENCODED = /=\?[^?\s]+\?[bBqQ]\?[^?\s]*\?=/;
const WHITE_SPACE_ONLY = /^[ \t\r\n]*$/;

/**
 * RFC 2047 allows 75 characters per encoded word. 66 keeps the longest header name this codec
 * starts a line with (`Reply-To: `) and a whole word within the 76 characters section 2 sets for
 * lines that hold encoded words.
 */
const MAX_WORD = 66;
const WORD_OVERHEAD = '=?UTF-8?Q??='.length;
/** RFC 2047 section 5 (3): the characters a `Q` word may carry as they are, even in a phrase. */
const Q_LITERAL = /^[A-Za-z0-9!*+\-/]$/;
/** Plain words longer than this are encoded too, so they can be split before 998 characters. */
const LONG_WORD = 900;

function wordBytes(encoding: string, text: string): Uint8Array | undefined {
	return encoding === 'b' || encoding === 'B'
		? decodeBase64(text)
		: decodeQuotedPrintable(text, { header: true });
}

/**
 * Decodes the RFC 2047 encoded words in `text`. `B` and `Q` work in any charset `decodeCharset`
 * reads. White space between two encoded words is dropped (section 6.2), and adjacent words in one
 * charset are decoded together, so a character an encoder split across two words survives. Words
 * are also found inside other text and quoted strings, as mail programs read them; a word that does
 * not decode (bad base64) is left as written.
 */
export function decodeEncodedWords(text: string): string {
	if (!text.includes('=?')) return text;
	let out = '';
	let last = 0;
	let charset = '';
	let pending: Uint8Array[] = [];
	const flush = (): void => {
		if (pending.length) out += decodeCharset(concatBytes(pending), charset);
		pending = [];
	};
	for (const match of text.matchAll(ENCODED_WORD)) {
		const bytes = wordBytes(match[2]!, match[3]!);
		if (!bytes) continue;
		const at = match.index ?? 0;
		const gap = text.slice(last, at);
		const label = normalizeCharset(match[1]);
		if (!pending.length || !WHITE_SPACE_ONLY.test(gap)) {
			flush();
			out += gap;
		} else if (label !== charset) flush();
		charset = label;
		pending.push(bytes);
		last = at + match[0].length;
	}
	flush();
	return out + text.slice(last);
}

function qChar(char: string): string {
	if (char === ' ') return '_';
	if (Q_LITERAL.test(char)) return char;
	let out = '';
	for (const byte of utf8(char)) out += `=${byte.toString(16).toUpperCase().padStart(2, '0')}`;
	return out;
}

/** `chars` packed into UTF-8 words of at most `MAX_WORD`, split only between code points. */
function pack(chars: readonly string[], base64: boolean): string[] {
	const room = MAX_WORD - WORD_OVERHEAD;
	const words: string[] = [];
	let raw = '';
	let q = '';
	let bytes = 0;
	const finish = (): void => {
		words.push(base64 ? `=?UTF-8?B?${encodeBase64(utf8(raw))}?=` : `=?UTF-8?Q?${q}?=`);
	};
	for (const char of chars) {
		const encoded = qChar(char);
		const length = utf8(char).length;
		const fits = base64
			? Math.ceil((bytes + length) / 3) * 4 <= room
			: q.length + encoded.length <= room;
		if (!fits && raw) {
			finish();
			raw = q = '';
			bytes = 0;
		}
		raw += char;
		q += encoded;
		bytes += length;
	}
	if (raw) finish();
	return words;
}

/** `text` as UTF-8 encoded words separated by spaces, `B` or `Q`, whichever is shorter. */
function encodeWords(text: string): string {
	const chars = Array.from(text);
	const q = pack(chars, false).join(' ');
	const b = pack(chars, true).join(' ');
	return b.length < q.length ? b : q;
}

/** True when `text` holds something a reader would decode as an encoded word. */
export const looksEncoded = (text: string): boolean => LOOKS_ENCODED.test(text);

const needsEncoding = (word: string): boolean =>
	/[^\t\x20-\x7e]/.test(word) || word.length > LONG_WORD || looksEncoded(word);

/**
 * Header text (`Subject`, an unstructured field) ready to write: unchanged when it is printable
 * ASCII, else each run of words that needs it (non-ASCII or control characters, or something a
 * reader would take for an encoded word) becomes UTF-8 encoded words of at most 66 characters,
 * keeping the white space between them inside the words so it survives decoding. Folding happens
 * later, at the spaces between words.
 */
export function encodeHeaderText(text: string): string {
	const parts = text.split(/([ \t]+)/);
	if (!parts.some((part, index) => index % 2 === 0 && needsEncoding(part))) return text;
	let out = '';
	for (let i = 0; i < parts.length; i += 2) {
		if (!needsEncoding(parts[i]!)) {
			out += parts[i]! + (parts[i + 1] ?? '');
			continue;
		}
		let end = i;
		while (end + 2 < parts.length && needsEncoding(parts[end + 2]!)) end += 2;
		out += encodeWords(parts.slice(i, end + 1).join('')) + (parts[end + 1] ?? '');
		i = end;
	}
	return out;
}

/**
 * A display name ready for an address list: atoms as they are, other printable ASCII as a quoted
 * string, and anything else as encoded words (never inside quotes, RFC 2047 section 5 (3)).
 */
export function encodePhrase(name: string): string {
	if (!name) return '';
	if (needsEncoding(name)) return encodeWords(name);
	return PLAIN_PHRASE.test(name) ? name : quoteString(name);
}
