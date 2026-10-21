// How the CSS half of the message sanitiser (sanitize-css.ts) reads tokens: an escape, a name, a
// string and a url token, each read as a browser's tokenizer reads it (CSS Syntax 3, section 4),
// into what it stands for and where it ends; and how it writes a URL back, as a CSS string. What
// stays and what goes is the scan's to decide. New code.

export const isSpace = (char: string): boolean => char === ' ' || char === '\t' || char === '\n';
const isHex = (char: string): boolean => /^[\da-f]$/i.test(char);
/** A letter, a digit, `-`, `_` or anything beyond ASCII. */
export const isNameChar = (char: string): boolean => /^[\w-]$/.test(char) || char >= '\u0080';
const isNonPrintable = (char: string): boolean => /^[\0-\b\v\x0e-\x1f\x7f]$/.test(char);
/** A backslash that starts an escape: not the last character, nor one before a newline. */
export const startsEscape = (css: string, at: number): boolean =>
	css.charAt(at) === '\\' && at + 1 < css.length && css.charAt(at + 1) !== '\n';

/** The character the escape at `at` (a backslash) stands for, and where the escape ends. */
function readEscape(css: string, at: number): [string, number] {
	let end = at + 1;
	while (end - at <= 6 && isHex(css.charAt(end))) end++;
	if (end === at + 1) return [css.charAt(end) || '\uFFFD', end + 1];
	const code = Number.parseInt(css.slice(at + 1, end), 16);
	if (isSpace(css.charAt(end))) end++;
	const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
	return [valid ? String.fromCodePoint(code) : '\uFFFD', end];
}

/** The name at `at`, escapes decoded and ASCII letters in lower case, and where it ends. */
export function readName(css: string, at: number): [string, number] {
	let name = '';
	let end = at;
	for (;;) {
		if (isNameChar(css.charAt(end))) name += css.charAt(end++);
		else if (startsEscape(css, end)) {
			const [char, next] = readEscape(css, end);
			name += char;
			end = next;
		} else return [name.replace(/[A-Z]/g, (char) => char.toLowerCase()), end];
	}
}

/**
 * The string at `at` (a quote): its value, null when a newline cuts it short, its end, and whether
 * the end of the input leaves it open.
 */
export function readString(css: string, at: number): [string | null, number, boolean] {
	const quote = css.charAt(at);
	let value = '';
	let end = at + 1;
	while (end < css.length) {
		const char = css.charAt(end);
		if (char === quote) return [value, end + 1, false];
		if (char === '\n') return [null, end, false];
		if (char !== '\\') {
			value += char;
			end++;
		} else if (css.charAt(end + 1) === '\n') end += 2;
		else if (end + 1 >= css.length) end++;
		else {
			const [escaped, next] = readEscape(css, end);
			value += escaped;
			end = next;
		}
	}
	return [value, end, true];
}

/**
 * The text of a string the end of the input leaves open, closed with its quote. A lone backslash
 * at its end (the last of an odd run, each pair being one escaped backslash) escapes nothing there,
 * but before a newline it would carry the string on to the next line, so it goes.
 */
export function closedString(text: string, quote: string): string {
	let run = 0;
	while (text.charAt(text.length - 1 - run) === '\\') run++;
	return `${run % 2 ? text.slice(0, -1) : text}${quote}`;
}

/** The end of a malformed url token: after its `)`, escapes skipped. */
function skipBadUrl(css: string, at: number): number {
	let end = at;
	while (end < css.length && css.charAt(end) !== ')')
		end = startsEscape(css, end) ? readEscape(css, end)[1] : end + 1;
	return Math.min(end + 1, css.length);
}

/** The url token whose text starts at `at` (after `url(`): its URL, null when malformed, its end. */
export function readUrl(css: string, at: number): [string | null, number] {
	let end = at;
	while (isSpace(css.charAt(end))) end++;
	let value = '';
	while (end < css.length) {
		const char = css.charAt(end);
		if (char === ')') return [value, end + 1];
		if (isSpace(char)) {
			while (isSpace(css.charAt(end))) end++;
			if (end >= css.length || css.charAt(end) === ')')
				return [value, Math.min(end + 1, css.length)];
			return [null, skipBadUrl(css, end)];
		}
		if (char === '"' || char === "'" || char === '(' || isNonPrintable(char))
			return [null, skipBadUrl(css, end)];
		if (char !== '\\') {
			value += char;
			end++;
		} else if (startsEscape(css, end)) {
			const [escaped, next] = readEscape(css, end);
			value += escaped;
			end = next;
		} else return [null, skipBadUrl(css, end)];
	}
	return [value, end];
}

/** A URL as a CSS string. */
export const quote = (url: string): string =>
	`"${url.replace(/["\\\0-\x1f\x7f]/g, (char) => (char === '"' || char === '\\' ? `\\${char}` : `\\${char.charCodeAt(0).toString(16)} `))}"`;
