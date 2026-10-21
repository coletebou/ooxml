// The CSS half of the message sanitiser (sanitize.ts): every place CSS loads a resource from, found
// the way a browser's tokenizer finds it (CSS Syntax 3), so an escaped name (`\75 rl(`), a name
// right after `<!--`, quotes or parentheses inside a URL, a URL of any length and a function left
// open at the end all count. Each URL goes through `resolve`, and a blocked one (an empty result)
// becomes `none`: the URL of `url()` and `src()`, and the strings of the image functions
// (`image-set()`, `image()`, `cross-fade()` and their prefixed forms). An image function holding
// something that can still turn into a URL (`var()`, `attr()`, `if()`, ...) becomes `none` too, and
// `@import` is always dropped. What an image function holds counts at any depth, inside the
// functions it allows (`calc()`, a gradient) or a block as much as directly: only the string of
// `type()`, a MIME type, is not a URL there. Strings anywhere else are text (`content: "url(x)"`)
// and stay. What is dropped or replaced never lets the text on its two sides join into a token
// this scan did not see (`u@import;rl(x)` must not become `url(x)`): a comment goes between them
// wherever they could run together. What the end of the input leaves open (a comment, a string, a
// function, a block) is closed in the output too, so CSS written after it is read on its own. The
// tokens are read in sanitize-css-tokens.ts. New code.
import {
	closedString,
	isNameChar,
	isSpace,
	quote,
	readName,
	readString,
	readUrl,
	startsEscape,
} from './sanitize-css-tokens';

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
	/**
	 * `url()` or `src()` with a string (its first string is the URL), an image function, `type()`
	 * (its string is a MIME type), other.
	 */
	kind: 'url' | 'image' | 'type' | 'other';
	/** Where its text starts in the output. */
	start: number;
	/** `url` frames: the value of the first string, null before one. */
	url: string | null;
	/** Image frames: a URL in it was blocked, or it holds a value that cannot be checked. */
	blocked: boolean;
}

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
	/**
	 * The open `url` and image frames, innermost last. Whatever is inside an image function, at any
	 * depth, belongs to it, unless a `url` frame (replaced as a whole) is nearer.
	 */
	const owners: Frame[] = [];
	/** The image function the scan is in, at any depth. */
	const image = (): Frame | undefined => {
		const owner = owners.at(-1);
		return owner?.kind === 'image' ? owner : undefined;
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
	/**
	 * Close a frame: a url frame becomes its URL, a blocked image frame `none` (which blocks the
	 * image function around it in turn).
	 */
	const finish = (frame: Frame): void => {
		if (frame.kind === 'url') urlFrames--;
		if (frame.kind !== 'url' && frame.kind !== 'image') return;
		owners.pop();
		if (frame.kind === 'image' && !frame.blocked) return;
		out.length = frame.start;
		if (frame.kind === 'url') writeUrl(frame.url);
		else none();
	};
	/**
	 * Close the innermost frame as its closing bracket does. An `@import` in it ends there, and so
	 * does one whose block it is.
	 */
	const close = (): void => {
		if (drop && stack.length === drop.depth) endDrop();
		const frame = stack.pop()!;
		out.push(frame.close);
		finish(frame);
		if (drop && frame.close === '}' && stack.length === drop.depth) endDrop();
	};

	let at = 0;
	while (at < css.length) {
		const char = css.charAt(at);
		const closer = CLOSERS[char];
		let end = at + 1;
		let text: string | null = null;
		if (char === '/' && css.charAt(at + 1) === '*') {
			const commentEnd = css.indexOf('*/', at + 2);
			end = commentEnd < 0 ? css.length : commentEnd + 2;
			// Left open by the end of the input, it is closed there (see the end of the scan).
			if (commentEnd < 0) text = `${css.slice(at)}*/`;
		} else if (char === '"' || char === "'") {
			const [value, stringEnd, open] = readString(css, at);
			end = stringEnd;
			const top = stack.at(-1);
			const owner = image();
			if (top?.kind === 'url') top.url ??= value ?? '';
			else if (owner && top?.kind !== 'type') {
				const target = resolved(value);
				if (target) text = quote(target);
				else owner.blocked = true;
			}
			// Left open by the end of the input, it is closed there too, unless it was replaced.
			if (open) text ??= closedString(css.slice(at, end), char);
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
								: name === 'type'
									? 'type'
									: 'other';
					const frame: Frame = { close: ')', kind, start: out.length, url: null, blocked: false };
					if (kind === 'url') urlFrames++;
					if (kind === 'url' || kind === 'image') owners.push(frame);
					stack.push(frame);
					end++;
				}
			}
		} else if (closer) {
			// A block is never part of an image function, at any depth.
			block();
			stack.push({ close: closer, kind: 'other', start: out.length, url: null, blocked: false });
		} else if (char === stack.at(-1)?.close) {
			close();
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
	// The end closes whatever is still open, as it does in a browser, and the output says so: CSS
	// written after it must not be read as part of it. A backslash that ends the input is read as
	// U+FFFD there; written before the closers, it would escape the first of them instead, so that
	// character takes its place.
	if (out.at(-1) === '\\') out[out.length - 1] = '\uFFFD';
	while (stack.length) close();
	endDrop();
	return joined(out);
}
