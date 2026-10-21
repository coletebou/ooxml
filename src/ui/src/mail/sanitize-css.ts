// The CSS half of the message sanitiser (sanitize.ts): every place CSS loads a resource from, found
// the way a browser's tokenizer finds it (CSS Syntax 3), so an escaped name (`\75 rl(`), a name
// right after `<!--`, quotes or parentheses inside a URL, a URL of any length and a function left
// open at the end all count. Each URL goes through `resolve`, and a blocked one (an empty result)
// becomes `none`: the URL of `url()` and `src()`, and the strings of the image functions
// (`image-set()`, `image()`, `cross-fade()` and their prefixed forms). An image function holding
// something that can still turn into a URL (`var()`, `attr()`, `if()`, ...) becomes `none` too, and
// `@import` is always dropped. Strings anywhere else are text (`content: "url(x)"`) and stay. What
// is dropped or replaced never lets the text on its two sides join into a token this scan did not
// see (`u@import;rl(x)` must not become `url(x)`): a comment goes between them wherever they could
// run together. New code.

/** The URL to load for `url`, or '' to block it. */
export type ResolveUrl = (url: string) => string;

/** Where text was dropped or replaced: the pieces on its two sides must not join. */
const CUT = Symbol('cut');
type Piece = string | typeof CUT;
/** A piece after which nothing joins: whitespace, punctuation or a comment. */
const ENDS_CLEANLY = /^[ \t\n()[\]{};,:]$|^\/\*/;
/** A name with no escape, not starting like a number: only a name character, `\` or `(` joins it. */
const PLAIN_NAME = /^[a-z_][\w-]*$/i;

/** The functions whose string arguments are URLs (CSS Images 4). */
const IMAGE_FUNCTIONS = new Set([
	'image',
	'image-set',
	'-webkit-image-set',
	'cross-fade',
	'-webkit-cross-fade',
]);
/** The functions an image function may hold: none of them can produce a URL string. */
const IMAGE_PARTS =
	/^(?:url|src|type|image|(?:-webkit-)?(?:image-set|cross-fade)|(?:-webkit-)?(?:repeating-)?(?:linear|radial|conic)-gradient|-webkit-gradient|rgba?|hsla?|hwb|(?:ok)?l(?:ab|ch)|color(?:-mix)?|calc|min|max|clamp)$/;
const CLOSERS: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' };

interface Frame {
	/** The character that closes it. */
	close: string;
	/** `url()` or `src()` with a string (its first string is the URL), an image function, other. */
	kind: 'url' | 'image' | 'other';
	/** Where its text starts in the output. */
	start: number;
	/** `url` frames: the value of the first string, null before one. */
	url: string | null;
	/** Image frames: a URL in it was blocked, or it holds a value that cannot be checked. */
	blocked: boolean;
}

const isSpace = (char: string): boolean => char === ' ' || char === '\t' || char === '\n';
const isHex = (char: string): boolean => /^[\da-f]$/i.test(char);
/** A letter, a digit, `-`, `_` or anything beyond ASCII. */
const isNameChar = (char: string): boolean => /^[\w-]$/.test(char) || char >= '\u0080';
const isNonPrintable = (char: string): boolean => /^[\0-\b\v\x0e-\x1f\x7f]$/.test(char);
/** A backslash that starts an escape: not the last character, nor one before a newline. */
const startsEscape = (css: string, at: number): boolean =>
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
function readName(css: string, at: number): [string, number] {
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

/** The string at `at` (a quote): its value, null when a newline cuts it short, and its end. */
function readString(css: string, at: number): [string | null, number] {
	const quote = css.charAt(at);
	let value = '';
	let end = at + 1;
	while (end < css.length) {
		const char = css.charAt(end);
		if (char === quote) return [value, end + 1];
		if (char === '\n') return [null, end];
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
	return [value, end];
}

/** The end of a malformed url token: after its `)`, escapes skipped. */
function skipBadUrl(css: string, at: number): number {
	let end = at;
	while (end < css.length && css.charAt(end) !== ')')
		end = startsEscape(css, end) ? readEscape(css, end)[1] : end + 1;
	return Math.min(end + 1, css.length);
}

/** The url token whose text starts at `at` (after `url(`): its URL, null when malformed, its end. */
function readUrl(css: string, at: number): [string | null, number] {
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
const quote = (url: string): string =>
	`"${url.replace(/["\\\0-\x1f\x7f]/g, (char) => (char === '"' || char === '\\' ? `\\${char}` : `\\${char.charCodeAt(0).toString(16)} `))}"`;

/**
 * Whether `next` written right after the piece `last` could read as other tokens than the two do
 * apart: a name, an escape or a number running on (`u` and `rl(`, `\7` and `5`), a name becoming a
 * function (`url` and `(`), `/` and `*` opening a comment, `@` and `import` an at-rule. A closing
 * bracket, `;` or `,` joins nothing before it (no piece ends in an unfinished backslash).
 */
function joins(last: string, next: string): boolean {
	const first = next.charAt(0);
	if (!last || ')]};,'.includes(first) || ENDS_CLEANLY.test(last)) return false;
	if (PLAIN_NAME.test(last)) return isNameChar(first) || first === '\\' || first === '(';
	return true;
}

/** The pieces as text, with a comment (the one thing no token runs across) where a cut joins. */
function joined(pieces: readonly Piece[]): string {
	let css = '';
	let last = '';
	let cut = false;
	for (const piece of pieces) {
		if (piece === CUT) {
			cut = true;
			continue;
		}
		if (cut && joins(last, piece)) css += '/**/';
		css += piece;
		last = piece;
		cut = false;
	}
	return css;
}

/** `input` with every resource it loads resolved, and `@import` dropped (see above). */
export function rewriteCss(input: string, resolve: ResolveUrl): string {
	// The tokenizer's preprocessing: one kind of newline, no NUL.
	const css = input.replace(/\r\n?|\f/g, '\n').replaceAll('\0', '\uFFFD');
	const out: Piece[] = [];
	const stack: Frame[] = [];
	/** The `@import` being dropped: where it starts in the output and how deep it is. */
	let drop: { start: number; depth: number } | null = null;
	/** Open `url` frames: text inside one is replaced as a whole, so nothing in it is resolved. */
	let urlFrames = 0;
	const image = (): Frame | undefined => {
		const top = stack.at(-1);
		return top?.kind === 'image' ? top : undefined;
	};
	const block = (): void => {
		const frame = image();
		if (frame) frame.blocked = true;
	};
	const resolved = (url: string | null): string => (url && !drop && !urlFrames ? resolve(url) : '');
	/** `none` for what is blocked (and the image function around it), cut off from what follows. */
	const none = (): void => {
		block();
		out.push('none', CUT);
	};
	const writeUrl = (url: string | null): void => {
		const target = resolved(url);
		if (target) out.push(`url(${quote(target)})`);
		else none();
	};
	const endDrop = (): void => {
		if (!drop) return;
		out.length = drop.start;
		out.push(CUT);
		drop = null;
	};
	/** Close a frame: a url frame becomes its URL, a blocked image frame `none`. */
	const finish = (frame: Frame): void => {
		if (frame.kind === 'url') urlFrames--;
		if (frame.kind === 'other' || (frame.kind === 'image' && !frame.blocked)) return;
		out.length = frame.start;
		if (frame.kind === 'url') writeUrl(frame.url);
		else none();
	};

	let at = 0;
	while (at < css.length) {
		const char = css.charAt(at);
		const closer = CLOSERS[char];
		let end = at + 1;
		let text: string | null = null;
		if (char === '/' && css.charAt(at + 1) === '*') {
			const close = css.indexOf('*/', at + 2);
			end = close < 0 ? css.length : close + 2;
		} else if (char === '"' || char === "'") {
			const [value, stringEnd] = readString(css, at);
			end = stringEnd;
			const top = stack.at(-1);
			if (top?.kind === 'url') top.url ??= value ?? '';
			else if (top?.kind === 'image') {
				const target = resolved(value);
				if (target) text = quote(target);
				else top.blocked = true;
			}
		} else if (char === '@') {
			const [name, nameEnd] = readName(css, at + 1);
			end = nameEnd;
			if (name === 'import' && !drop) drop = { start: out.length, depth: stack.length };
		} else if (char === '<' && css.startsWith('!--', at + 1)) {
			// `<!--` is one token, so a name right after it starts on its own (`<!--url(`).
			end = at + 4;
		} else if (isNameChar(char) || startsEscape(css, at)) {
			const [name, nameEnd] = readName(css, at);
			end = nameEnd;
			if (css.charAt(end) === '(') {
				if (image() && !IMAGE_PARTS.test(name)) block();
				let after = end + 1;
				while (isSpace(css.charAt(after))) after++;
				const quoted = css.charAt(after) === '"' || css.charAt(after) === "'";
				if (name === 'url' && !quoted) {
					const [url, urlEnd] = readUrl(css, end + 1);
					writeUrl(url);
					at = urlEnd;
					continue;
				} else {
					const kind =
						name === 'url' || name === 'src'
							? 'url'
							: IMAGE_FUNCTIONS.has(name)
								? 'image'
								: 'other';
					if (kind === 'url') urlFrames++;
					stack.push({ close: ')', kind, start: out.length, url: null, blocked: false });
					end++;
				}
			}
		} else if (closer) {
			// A block is never part of an image function.
			block();
			stack.push({ close: closer, kind: 'other', start: out.length, url: null, blocked: false });
		} else if (char === stack.at(-1)?.close) {
			if (drop && stack.length === drop.depth) endDrop();
			const frame = stack.pop()!;
			out.push(char);
			finish(frame);
			if (drop && char === '}' && stack.length === drop.depth) endDrop();
			at = end;
			continue;
		} else if (char === ';' && drop && stack.length === drop.depth) {
			endDrop();
			at = end;
			continue;
		}
		out.push(text ?? css.slice(at, end));
		at = end;
	}
	// The end closes whatever is still open, as it does in a browser.
	while (stack.length) {
		if (drop && stack.length === drop.depth) endDrop();
		finish(stack.pop()!);
	}
	endDrop();
	return joined(out);
}
