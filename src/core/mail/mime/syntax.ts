// Lexical pieces of RFC 5322 structured header fields shared by the address, date, parameter and
// message-id readers: atoms, quoted strings and comments. New code.

/** RFC 5322 `atext` (ASCII), as a character class body. */
const ATEXT = "A-Za-z0-9!#$%&'*+\\-/=?^_`{|}~";

/** One RFC 5322 atom. */
export const ATOM = new RegExp(`^[${ATEXT}]+$`);

/** A phrase that needs no quoting: atoms separated by single spaces. */
export const PLAIN_PHRASE = new RegExp(`^[${ATEXT}]+(?: [${ATEXT}]+)*$`);

/** An RFC 5322 `dot-atom`, with the UTF-8 of RFC 6532 allowed in it. */
export const DOT_ATOM = new RegExp(
	`^[${ATEXT}\\u0080-\\uffff]+(?:\\.[${ATEXT}\\u0080-\\uffff]+)*$`,
);

/** `text` as an RFC 5322 quoted string: `"` and `\` escaped. */
export const quoteString = (text: string): string => `"${text.replace(/(["\\])/g, '\\$1')}"`;

/**
 * `text` without any of `chars` at either end. A loop, because a regex such as `[ \t]+$` backtracks
 * over every run of those characters inside the text, quadratic on hostile input.
 */
export function trimChars(text: string, chars: string): string {
	let start = 0;
	let end = text.length;
	while (start < end && chars.includes(text[start]!)) start++;
	while (end > start && chars.includes(text[end - 1]!)) end--;
	return text.slice(start, end);
}

/** `text` without spaces and tabs at either end (RFC 5322 WSP). */
export const trimBlanks = (text: string): string => trimChars(text, ' \t');

/**
 * Removes RFC 5322 comments, `(...)` with nesting and quoted pairs, leaving quoted strings alone.
 * Each comment becomes one space, since a comment separates tokens the way white space does. An
 * unterminated comment runs to the end.
 */
export function stripComments(text: string): string {
	if (!text.includes('(')) return text;
	let out = '';
	let depth = 0;
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i]!;
		if (depth > 0) {
			if (char === '\\') i++;
			else if (char === '(') depth++;
			else if (char === ')' && --depth === 0) out += ' ';
			continue;
		}
		if (quoted && char === '\\') {
			out += char + (text[i + 1] ?? '');
			i++;
			continue;
		}
		if (char === '"') quoted = !quoted;
		else if (char === '(' && !quoted) {
			depth = 1;
			continue;
		}
		out += char;
	}
	return out;
}
