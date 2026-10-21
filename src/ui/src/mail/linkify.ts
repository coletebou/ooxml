// Finding the links in a plain-text message body, which the reading pane shows as text with links
// and never as markup. New code.

export interface TextSegment {
	text: string;
	/** Set on a link: an `http(s)` or `mailto` address. */
	href?: string;
}

/** Where a found link points: an address becomes `mailto:`, a bare `www.` host `https://`. */
function linkHref(value: string): string {
	if (value.includes('@') && !/^https?:|^www\./i.test(value)) return `mailto:${value}`;
	if (/^www\./i.test(value)) return `https://${value}`;
	return value;
}

/** Plain text split into text and links (`https://...`, `www....`, addresses), never markup. */
export function linkify(text: string): TextSegment[] {
	const out: TextSegment[] = [];
	// Bounded quantifiers (RFC 5321 length limits for addresses) keep this linear on hostile text.
	const pattern =
		/\b(?:https?:\/\/|www\.)[^\s<>"]{0,2048}[^\s<>".,;:!?)\]]|\b[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}\b/gi;
	let at = 0;
	for (const match of text.matchAll(pattern)) {
		const start = match.index ?? 0;
		if (start > at) out.push({ text: text.slice(at, start) });
		const value = match[0];
		out.push({ text: value, href: linkHref(value) });
		at = start + value.length;
	}
	if (at < text.length) out.push({ text: text.slice(at) });
	return out;
}
