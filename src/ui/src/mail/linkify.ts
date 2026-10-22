// Finding the links in a plain-text message body, which the reading pane shows as text with links
// and never as markup. New code.

export interface TextSegment {
	text: string;
	/** Set on a link: an `http(s)` or `mailto` address. */
	href?: string;
}

/** Where a found link points: an address becomes `mailto:`, a bare `www.` host `https://`. */
function linkHref(value: string): string {
	// RFC 6068 2: what an address holds that a mailto: link may not (# ? % & = /) is encoded, so the
	// link writes to the address shown and adds no field of its own.
	if (value.includes('@') && !/^https?:|^www\./i.test(value))
		return `mailto:${encodeURIComponent(value).replace(/%40/g, '@')}`;
	if (/^www\./i.test(value)) return `https://${value}`;
	return value;
}

const URL_PATTERN = String.raw`\b(?:https?:\/\/|www\.)[^\s<>"]{0,2048}[^\s<>".,;:!?)\]]`;
/**
 * An address, its local part whole (RFC 5322 atext: `o'connor`, `a=b`). It never starts inside a
 * word, nor right after another local-part character or a word and an apostrophe (`d’arcy`):
 * where its start cannot be told, nothing is linked rather than its end, an address of someone
 * else. Nor does it end inside a word, which `\b` alone (ASCII) would let it do before `ö`
 * (`user@shop.coöperatie.nl`), or after a hyphen: the domain is whole, or nothing is linked.
 */
const ADDRESS_PATTERN = String.raw`(?<![\p{L}\p{N}_.!#$%&*+\/=?^${'`'}{|}~-]|[\p{L}\p{N}_]['’])[\w+-][\w.!#$%&'*+\/=?^${'`'}{|}~-]{0,63}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}(?<!-)(?![\p{L}\p{N}\p{M}_-])`;
/** Bounded quantifiers (RFC 5321 length limits for addresses) keep this linear on hostile text. */
const LINKS = new RegExp(`${URL_PATTERN}|${ADDRESS_PATTERN}`, 'giu');

/** Plain text split into text and links (`https://...`, `www....`, addresses), never markup. */
export function linkify(text: string): TextSegment[] {
	const out: TextSegment[] = [];
	let at = 0;
	for (const match of text.matchAll(LINKS)) {
		const start = match.index ?? 0;
		if (start > at) out.push({ text: text.slice(at, start) });
		const value = match[0];
		out.push({ text: value, href: linkHref(value) });
		at = start + value.length;
	}
	if (at < text.length) out.push({ text: text.slice(at) });
	return out;
}
