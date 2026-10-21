// What `cleanCss` writes, read back the way a browser reads it: whatever goes in, nothing that comes
// out loads a resource while remote content is off (only `data:image/` URLs stay) or imports a
// stylesheet, or leaves open what would take in CSS written after it. The reader is its own
// implementation of the CSS Syntax 3 tokenizer (section 4), not the sanitiser's scanner, so a
// misreading the two shared would still show.
import { cleanCss } from './sanitize';

type Token =
	| { type: 'url' | 'string' | 'function' | 'at-keyword'; value: string }
	| { type: 'open' | 'close'; value: string }
	| { type: 'other' };

const isDigit = (char: string): boolean => char >= '0' && char <= '9';
const isHex = (char: string): boolean => /^[\da-f]$/i.test(char);
const isSpace = (char: string): boolean => char === ' ' || char === '\t' || char === '\n';
const isIdentStart = (char: string): boolean => /^[a-z_]$/i.test(char) || char >= '\u0080';
const isIdent = (char: string): boolean => isIdentStart(char) || isDigit(char) || char === '-';
const lower = (text: string): string => text.replace(/[A-Z]/g, (char) => char.toLowerCase());

/** The tokens of `input` that decide what loads; the rest are `other`, whitespace is left out. */
function tokenize(input: string): Token[] {
	const css = input.replace(/\r\n?|\f/g, '\n').replaceAll('\0', '\uFFFD');
	const char = (at: number): string => css.charAt(at);
	const isEscape = (at: number): boolean => char(at) === '\\' && char(at + 1) !== '\n';
	const startsIdent = (at: number): boolean =>
		char(at) === '-'
			? isIdentStart(char(at + 1)) || char(at + 1) === '-' || isEscape(at + 1)
			: isIdentStart(char(at)) || isEscape(at);
	const startsNumber = (at: number): boolean => {
		const first = char(at);
		if (first === '+' || first === '-')
			return isDigit(char(at + 1)) || (char(at + 1) === '.' && isDigit(char(at + 2)));
		return isDigit(first) || (first === '.' && isDigit(char(at + 1)));
	};
	let i = 0;
	/** The code point an escape stands for; `i` is just past its backslash. */
	const escaped = (): string => {
		if (!char(i)) return '\uFFFD';
		if (!isHex(char(i))) return char(i++);
		let hex = '';
		while (hex.length < 6 && isHex(char(i))) hex += char(i++);
		if (isSpace(char(i))) i++;
		const code = Number.parseInt(hex, 16);
		const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
		return valid ? String.fromCodePoint(code) : '\uFFFD';
	};
	const name = (): string => {
		let value = '';
		for (;;) {
			if (isIdent(char(i))) value += char(i++);
			else if (isEscape(i)) {
				i++;
				value += escaped();
			} else return value;
		}
	};
	const numeric = (): Token => {
		if (char(i) === '+' || char(i) === '-') i++;
		while (isDigit(char(i))) i++;
		if (char(i) === '.' && isDigit(char(i + 1))) for (i++; isDigit(char(i));) i++;
		const sign = char(i + 1) === '+' || char(i + 1) === '-' ? 1 : 0;
		if (lower(char(i)) === 'e' && isDigit(char(i + 1 + sign)))
			for (i += 1 + sign; isDigit(char(i));) i++;
		if (startsIdent(i)) name();
		else if (char(i) === '%') i++;
		return { type: 'other' };
	};
	const badUrl = (): Token => {
		while (i < css.length && char(i) !== ')') {
			if (isEscape(i)) {
				i++;
				escaped();
			} else i++;
		}
		i++;
		return { type: 'other' };
	};
	/** A url token; `i` is just past `url(`. */
	const url = (): Token => {
		while (isSpace(char(i))) i++;
		let value = '';
		for (;;) {
			const next = char(i);
			if (!next || next === ')') {
				i++;
				return { type: 'url', value };
			}
			if (isSpace(next)) {
				while (isSpace(char(i))) i++;
				if (!char(i) || char(i) === ')') {
					i++;
					return { type: 'url', value };
				}
				return badUrl();
			}
			if (/^["'(\0-\b\v\x0e-\x1f\x7f]$/.test(next)) return badUrl();
			if (next !== '\\') {
				value += next;
				i++;
			} else if (isEscape(i)) {
				i++;
				value += escaped();
			} else return badUrl();
		}
	};
	const string = (): Token => {
		const quote = char(i++);
		let value = '';
		for (;;) {
			const next = char(i);
			if (next === quote || !next) {
				i++;
				return { type: 'string', value };
			}
			if (next === '\n') return { type: 'other' };
			if (next !== '\\') {
				value += next;
				i++;
			} else if (!char(i + 1)) i++;
			else if (char(i + 1) === '\n') i += 2;
			else {
				i++;
				value += escaped();
			}
		}
	};
	const identLike = (): Token => {
		const value = lower(name());
		if (char(i) !== '(') return { type: 'other' };
		i++;
		if (value !== 'url') return { type: 'function', value };
		while (isSpace(char(i)) && isSpace(char(i + 1))) i++;
		const quote = isSpace(char(i)) ? char(i + 1) : char(i);
		return quote === '"' || quote === "'" ? { type: 'function', value } : url();
	};

	const tokens: Token[] = [];
	while (i < css.length) {
		const next = char(i);
		if (next === '/' && char(i + 1) === '*') {
			const end = css.indexOf('*/', i + 2);
			i = end < 0 ? css.length : end + 2;
		} else if (isSpace(next)) i++;
		else if (next === '"' || next === "'") tokens.push(string());
		else if ('([{'.includes(next)) tokens.push({ type: 'open', value: char(i++) });
		else if (')]}'.includes(next)) tokens.push({ type: 'close', value: char(i++) });
		else if (startsNumber(i)) tokens.push(numeric());
		else if (next === '-' && css.startsWith('->', i + 1)) i += 3;
		else if (next === '<' && css.startsWith('!--', i + 1)) i += 4;
		else if (startsIdent(i)) tokens.push(identLike());
		else if (next === '@' && startsIdent(i + 1)) {
			i++;
			tokens.push({ type: 'at-keyword', value: lower(name()) });
		} else if (next === '#' && (isIdent(char(i + 1)) || isEscape(i + 1))) {
			i++;
			name();
			tokens.push({ type: 'other' });
		} else {
			i++;
			tokens.push({ type: 'other' });
		}
	}
	return tokens;
}

const IMAGE = new Set([
	'image',
	'image-set',
	'-webkit-image-set',
	'cross-fade',
	'-webkit-cross-fade',
]);
/** Functions whose value is only known later, so a URL can come out of one. */
const LATE = new Set(['var', 'attr', 'env', 'if', 'inherit']);
const CLOSER: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' };

/** What a browser fetches for `css`: each URL that is not a `data:` image, and each `@import`. */
function loads(css: string): string[] {
	const found: string[] = [];
	const load = (url: string): void => {
		if (!/^\s*data:image\//i.test(url)) found.push(url);
	};
	const open: { name: string; close: string }[] = [];
	for (const token of tokenize(css)) {
		const parent = open.at(-1)?.name ?? '';
		if (token.type === 'url') load(token.value);
		else if (token.type === 'string') {
			if (parent === 'url' || parent === 'src' || IMAGE.has(parent)) load(token.value);
		} else if (token.type === 'at-keyword') {
			if (token.value === 'import') found.push('@import');
		} else if (token.type === 'function') {
			const inImage = open.some(({ name }) => IMAGE.has(name) || name === 'src' || name === 'url');
			if (inImage && LATE.has(token.value)) found.push(`${token.value}()`);
			open.push({ name: token.value, close: ')' });
		} else if (token.type === 'open') open.push({ name: '', close: CLOSER[token.value]! });
		else if (token.type === 'close' && open.at(-1)?.close === token.value) open.pop();
	}
	return found;
}

/**
 * Whether a browser reads the CSS after `css`, on a line of its own, as it reads it alone: no comment
 * or string of `css` takes it in, and no block or function of `css` holds it.
 */
function readsAfter(css: string): boolean {
	const tokens = tokenize(`${css}\n@after`);
	const last = tokens.pop();
	if (last?.type !== 'at-keyword' || last.value !== 'after') return false;
	const open: string[] = [];
	for (const token of tokens) {
		if (token.type === 'function') open.push(')');
		else if (token.type === 'open') open.push(CLOSER[token.value]!);
		else if (token.type === 'close' && open.at(-1) === token.value) open.pop();
	}
	return !open.length;
}

/** A seeded generator (mulberry32), so a failure replays the same way. */
function random(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** The inputs among `inputs` whose cleaned CSS still loads something, with what it loads. */
function leaks(inputs: Iterable<string>): { css: string; cleaned: string; loads: string[] }[] {
	const found = [];
	for (const css of inputs) {
		const cleaned = cleanCss(css);
		const loaded = loads(cleaned);
		if (loaded.length) found.push({ css, cleaned, loads: loaded });
	}
	return found;
}

/**
 * The inputs among `inputs` whose cleaned CSS is not finished: it leaves open what would take in
 * the CSS after it, or cleaning it again changes it.
 */
function unfinished(inputs: Iterable<string>): { css: string; cleaned: string; again: string }[] {
	const found = [];
	for (const css of inputs) {
		const cleaned = cleanCss(css);
		const again = cleanCss(cleaned);
		if (!readsAfter(cleaned) || again !== cleaned) found.push({ css, cleaned, again });
	}
	return found;
}

/** Each way to load something remotely, ... */
const LOADING = [
	'url(https://t.example/p)',
	'URL( "https://t.example/p" )',
	'\\75 rl(https://t.example/p)',
	'u\\72 l(//t.example/p)',
	'src("https://t.example/p")',
	'image-set("https://t.example/p" 1x)',
	'-webkit-image-set(url(https://t.example/p) 1x)',
	'image("https://t.example/p")',
	'cross-fade("https://t.example/p", red)',
	'@import "https://t.example/a.css";',
	'@\\69mport url(https://t.example/a.css);',
	'/*"*/url(https://t.example/p)/*"*/',
];
/** ... cut anywhere by something the sanitiser removes or replaces. */
const REMOVED = [
	'@import;',
	'@import x;',
	'@import url(https://t.example/i.css) screen;',
	'@\\69mport;',
	'@import{}',
	'src("https://t.example/s")',
	'url(https://t.example/u)',
	'url("https://t.example/u")',
	'url(https://t.example/a"b)',
	'image-set("https://t.example/i" 1x)',
	'image-set(var(--u) 1x)',
	'image-set(calc(var(--u)) 1x)',
	'image-set(min(1px, {"https://t.example/m"}) 1x)',
];
const CONTEXTS = [
	(css: string) => css,
	(css: string) => `background:${css}`,
	(css: string) => `p{b:${css}}`,
];

function* splitLoads(): Generator<string> {
	for (const loading of LOADING)
		for (let at = 0; at <= loading.length; at++)
			for (const removed of REMOVED)
				for (const context of CONTEXTS)
					yield context(`${loading.slice(0, at)}${removed}${loading.slice(at)}`);
}

/** Fragments of everything above, and of the CSS around it. */
const FRAGMENTS = [
	...['u', 'r', 'l', 'rl', 'url', 'URL', 's', 'src', 'rc', 'i', 'image', 'mage', '-set', 'e'],
	...['image-set', 'cross-fade', '-webkit-', 'x', 'é', '_', '-', '--u', 'none', 'import'],
	...['IMPORT', '1x', '\\', '\\75', '\\75 ', '\\7', '5', '\\72', '\\6c', '\\69', '\\55 ', '\\28'],
	...['\\29', '\\@', ' ', '\t', '\n', '\r', '\f', '\0', '(', ')', '[', ']', '{', '}', ';', ':'],
	...[',', '/', '*', '/*', '*/', '"', "'", '#', '@', '+', '.', '0', '1', '%', '<!--', '-->', '!'],
	...['<', '@import', '@import;', '@\\69mport', 'url(', 'src(', 'image-set(', 'image('],
	...['cross-fade(', 'type("image/png")', 'var(--u)', 'attr(title)', 'if(', 'expression('],
	...['calc(', 'min(', 'rgb('],
	...['linear-gradient(red, blue)', 'javascript:', 'https://t.example/p', '//t.example/p'],
	...['"https://t.example/p"', "'//t.example/p'", 'cid:x', 'data:image/png,x'],
	...['"data:image/png,x"'],
];

function* soup(seed: number, count: number): Generator<string> {
	const next = random(seed);
	for (let n = 0; n < count; n++) {
		let css = '';
		for (let length = 1 + Math.floor(next() * 16); length > 0; length--)
			css += FRAGMENTS[Math.floor(next() * FRAGMENTS.length)];
		yield css;
	}
}

describe('cleanCss output, read as a browser reads it', () => {
	it('is read by an independent tokenizer that finds what a browser would load', () => {
		const cases: [css: string, loaded: string[]][] = [
			['background:url(https://t.example/p)', ['https://t.example/p']],
			['background:\\75 rl( //t.example/p )', ['//t.example/p']],
			['background:URL( "https://t.example/p" 1x)', ['https://t.example/p']],
			['b:image-set(image("https://t.example/p") 1x)', ['https://t.example/p']],
			['b:image-set(var(--u) 1x)', ['var()']],
			['b:image-set(calc(var(--u)) 1x)', ['var()']],
			['@\\69mport "a.css";', ['@import']],
			['/*"*/url(x)/*"*/', ['x']],
			// None of these loads.
			['b:u/**/rl(https://t.example/p)', []],
			['content:"https://t.example/p";b:#url(https://t.example/p)', []],
			['b:1url(https://t.example/p);b:url(https://t.example/a"b)', []],
			['b:image-set(type("https://t.example/p") 1x);b:url(data:image/png,x)', []],
		];
		for (const [css, loaded] of cases) expect(loads(css), css).toEqual(loaded);
		// It also finds what would take in the CSS after it. A newline ends a string, unless a
		// backslash before it carries the string on, but it does not end a url token.
		for (const open of ['p{color:red', 'p{color:red}/* note', 'b:calc(1px', 'b:"x\\', 'b:url(x'])
			expect(readsAfter(open), open).toBe(false);
		for (const closed of ['p{color:red}', 'b:"x', 'b:"x\\\\"', 'b:x\\'])
			expect(readsAfter(closed), closed).toBe(true);
	});

	it('loads nothing when what loads is cut anywhere by something removed', () => {
		expect(leaks(splitLoads()).slice(0, 5)).toEqual([]);
	});

	it('loads nothing for random mixes of what it removes and what is around it', () => {
		expect(leaks(soup(0x5eed, 20_000)).slice(0, 5)).toEqual([]);
	});

	it('leaves nothing open for the CSS after it, nor anything to clean again', () => {
		expect(unfinished(splitLoads()).slice(0, 5)).toEqual([]);
		expect(unfinished(soup(0x5eed, 20_000)).slice(0, 5)).toEqual([]);
	});
});
