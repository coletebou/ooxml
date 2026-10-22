// Address lists (RFC 5322 section 3.4) read the way RFC 8621 `asAddresses` reads them (groups
// flattened into their members, display names decoded, best effort on anything malformed) and
// written for outgoing headers; and the msg-id lists of `Message-ID`, `In-Reply-To` and
// `References` (section 3.6.4), plus `Content-ID`. New code.
import type { MailAddress } from '../model';
import { tokenizeAddresses, type AddressToken } from './address-tokens';
import { decodeEncodedWords, encodePhrase } from './encoded-words';
import { DOT_ATOM, quoteString, stripComments, trimChars } from './syntax';

const isSpecial = (token: AddressToken | undefined, text: string): boolean =>
	token?.kind === 'special' && token.text === text;

function lastIndex(
	tokens: readonly AddressToken[],
	test: (token: AddressToken) => boolean,
): number {
	for (let i = tokens.length - 1; i >= 0; i--) if (test(tokens[i]!)) return i;
	return -1;
}

/** A display name: words joined by one space where there was white space, encoded words decoded. */
function phrase(tokens: readonly AddressToken[]): string {
	let text = '';
	for (const token of tokens) {
		if (token.kind !== 'comment') text += text && token.space ? ` ${token.text}` : token.text;
	}
	return decodeEncodedWords(text).trim();
}

/**
 * An addr-spec from its tokens, without white space or comments (so the obsolete `jdoe@test .
 * example` reads `jdoe@test.example`). A quoted local part loses its quotes when it needs none.
 */
function addrSpec(tokens: readonly AddressToken[]): string {
	let out = '';
	for (const token of tokens) {
		if (token.kind === 'comment') continue;
		const quoted = token.kind === 'quoted' && !DOT_ATOM.test(token.text);
		out += quoted ? quoteString(token.text) : token.text;
	}
	return out;
}

/** The first comment from `start` on: the name of `ada@example.com (Ada)` (RFC 8621 4.1.2.3). */
function commentFrom(tokens: readonly AddressToken[], start: number): string {
	for (let i = start; i < tokens.length; i++)
		if (tokens[i]!.kind === 'comment') return decodeEncodedWords(tokens[i]!.text).trim();
	return '';
}

function readMailbox(tokens: readonly AddressToken[]): MailAddress | null {
	const open = tokens.findIndex((token) => isSpecial(token, '<'));
	if (open >= 0) {
		const found = tokens.findIndex((token, index) => index > open && isSpecial(token, '>'));
		const close = found < 0 ? tokens.length : found;
		let spec = tokens.slice(open + 1, close);
		// The obsolete source route of `<@relay.example:ada@example.com>` is dropped.
		const route = lastIndex(spec, (token) => isSpecial(token, ':'));
		if (route >= 0) spec = spec.slice(route + 1);
		const email = addrSpec(spec);
		const name = phrase(tokens.slice(0, open)) || commentFrom(tokens, close);
		return email || name ? { name, email } : null;
	}
	const words = tokens.filter((token) => token.kind !== 'comment');
	if (!words.length) return null;
	// Without `@`, one unbroken word is a local-only address and several words are just a name.
	const isSpec =
		words.some((token) => isSpecial(token, '@')) ||
		words.every((token, index) => index === 0 || !token.space);
	if (!isSpec) return { name: phrase(words), email: '' };
	const last = lastIndex(tokens, (token) => token.kind !== 'comment');
	return { name: commentFrom(tokens, last + 1), email: addrSpec(words) };
}

/**
 * The mailboxes of an address list: `name-addr`, bare `addr-spec`, groups (`Team: a@x, b@y;`)
 * flattened into their members, quoted local parts, nested comments, obsolete routes and white
 * space, and display names decoded from encoded words, even inside quotes. Never throws: what
 * cannot be read is skipped, and a name without an address keeps an empty `email`.
 */
export function parseAddressList(value: string | undefined): MailAddress[] {
	if (!value) return [];
	const tokens = tokenizeAddresses(value);
	const out: MailAddress[] = [];
	let current: AddressToken[] = [];
	let angle = false;
	// Set once the current entry has an `@` or `<`: a `:` after that is no group name's end.
	let hasAddress = false;
	const flush = (): void => {
		const address = readMailbox(current);
		if (address) out.push(address);
		current = [];
		hasAddress = false;
	};
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]!;
		if (token.kind === 'special') {
			const next = tokens[i + 1];
			const routeComma = angle && (isSpecial(next, '@') || isSpecial(next, ','));
			if (token.text === '<') angle = hasAddress = true;
			else if (token.text === '>') angle = false;
			else if (token.text === '@') hasAddress = true;
			else if (token.text === ',' && !routeComma) {
				// A comma inside an unclosed `<` still separates addresses.
				angle = false;
				flush();
				continue;
			} else if (token.text === ';' && !angle) {
				flush();
				continue;
			} else if (token.text === ':' && !angle && !hasAddress) {
				current = [];
				continue;
			}
		}
		current.push(token);
	}
	flush();
	return out;
}

/**
 * `email` as an addr-spec that is safe to write: the local part quoted when it is not a dot-atom,
 * and characters no domain holds removed, so no value can add an address or end the field.
 * Non-ASCII stays as UTF-8 (RFC 6532).
 */
export function formatAddrSpec(email: string): string {
	const clean = email.replace(/[\r\n]+/g, '');
	const at = clean.lastIndexOf('@');
	const local = at < 0 ? clean : clean.slice(0, at);
	const quoted = /^"(?:[^"\\]|\\.)*"$/.test(local) || DOT_ATOM.test(local);
	const safeLocal = quoted ? local : quoteString(local);
	if (at < 0) return safeLocal;
	const domain = clean.slice(at + 1);
	const literal = /^\[[^[\]\\]*\]$/.test(domain);
	return `${safeLocal}@${literal ? domain : domain.replace(/[\s<>()[\]\\,;:@"]/g, '')}`;
}

/** One mailbox for a header: `Name <ada@example.com>`, or the bare address without a name. */
export function formatMailbox(address: MailAddress): string {
	const email = formatAddrSpec(address.email);
	return address.name ? `${encodePhrase(address.name)} <${email}>` : email;
}

/** An address list for a header, `, ` between mailboxes; addresses without an email are left out. */
export function formatAddressList(list: readonly MailAddress[]): string {
	return list
		.filter((address) => address.email)
		.map(formatMailbox)
		.join(', ');
}

/**
 * The ids of a msg-id list, without angle brackets: comments and the white space of the obsolete
 * syntax removed (`<1234 @ local(blah) .machine .example>` reads `1234@local.machine.example`).
 * Ids written without brackets are found as words with an `@`; phrases between ids are ignored.
 */
export function parseMessageIds(value: string | undefined): string[] {
	if (!value) return [];
	const text = stripComments(value);
	const bracketed = Array.from(text.matchAll(/<([^<>]*)>/g), (match) =>
		match[1]!.replace(/\s+/g, ''),
	).filter(Boolean);
	if (bracketed.length) return bracketed;
	return text
		.split(/[\s,]+/)
		.map((word) => trimChars(word, '<>'))
		.filter((word) => word.includes('@'));
}

/** Ids as a msg-id list: `<a@x> <b@y>`, white space and brackets inside an id removed. */
export function formatMessageIds(ids: readonly string[]): string {
	return ids
		.map((id) => id.replace(/[\s<>]+/g, ''))
		.filter(Boolean)
		.map((id) => `<${id}>`)
		.join(' ');
}

/** The id of a `Content-ID` field without angle brackets, also when written bare; else `null`. */
export function parseContentId(value: string | undefined): string | null {
	if (!value) return null;
	const [id] = parseMessageIds(value);
	return id ?? (stripComments(value).replace(/[\s<>]+/g, '') || null);
}
