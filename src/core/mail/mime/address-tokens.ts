// The tokens of an RFC 5322 address list (section 3.2): atoms, quoted strings, comments, domain
// literals and the specials that give the list its structure. New code.

export interface AddressToken {
	kind: 'atom' | 'quoted' | 'comment' | 'literal' | 'special';
	/** The text; for a quoted string or comment, its content without delimiters or escapes. */
	text: string;
	/** True when white space or a comment came before the token. */
	space: boolean;
}

const SPECIALS = new Set(['<', '>', '@', ',', ';', ':', '.']);
const ATOM_STOP = new Set([' ', '\t', '\r', '\n', '(', '"', '[', ...SPECIALS]);
/** An encoded word is one atom even when a careless encoder left a `,` or `.` in its text. */
const ENCODED_WORD = /=\?[^?\s]+\?[bBqQ]\?[^?\s]*\?=/y;

/** The content of the comment at `start`, nested comments kept, and the index after it. */
function readComment(text: string, start: number): [string, number] {
	let depth = 0;
	let out = '';
	for (let i = start; i < text.length; i++) {
		const char = text[i]!;
		if (char === '\\') out += text[++i] ?? '';
		else if (char === '(') {
			if (depth++ > 0) out += char;
		} else if (char === ')') {
			if (--depth === 0) return [out, i + 1];
			out += char;
		} else out += char;
	}
	return [out, text.length];
}

/** The content of the quoted string at `start`, quoted pairs unescaped, and the index after it. */
function readQuoted(text: string, start: number): [string, number] {
	let out = '';
	for (let i = start + 1; i < text.length; i++) {
		const char = text[i]!;
		if (char === '"') return [out, i + 1];
		out += char === '\\' && i + 1 < text.length ? text[++i] : char;
	}
	return [out, text.length];
}

/**
 * Splits an address list into tokens. Unterminated quoted strings, comments and literals run to
 * the end; stray characters that fit nowhere (`)`, `]`, non-ASCII) become part of an atom.
 */
export function tokenizeAddresses(text: string): AddressToken[] {
	const tokens: AddressToken[] = [];
	let space = false;
	let i = 0;
	while (i < text.length) {
		const char = text[i]!;
		if (char === ' ' || char === '\t' || char === '\r' || char === '\n') {
			space = true;
			i++;
			continue;
		}
		if (char === '(') {
			const [content, next] = readComment(text, i);
			tokens.push({ kind: 'comment', text: content, space });
			space = true;
			i = next;
			continue;
		}
		let token: Omit<AddressToken, 'space'>;
		let next: number;
		if (char === '"') {
			const [content, end] = readQuoted(text, i);
			token = { kind: 'quoted', text: content };
			next = end;
		} else if (char === '[') {
			const close = text.indexOf(']', i);
			next = close < 0 ? text.length : close + 1;
			token = { kind: 'literal', text: text.slice(i, next) };
		} else if (SPECIALS.has(char)) {
			token = { kind: 'special', text: char };
			next = i + 1;
		} else {
			ENCODED_WORD.lastIndex = i;
			next = char === '=' && ENCODED_WORD.test(text) ? ENCODED_WORD.lastIndex : i + 1;
			while (next < text.length && !ATOM_STOP.has(text[next]!)) next++;
			token = { kind: 'atom', text: text.slice(i, next) };
		}
		tokens.push({ ...token, space });
		space = false;
		i = next;
	}
	return tokens;
}
