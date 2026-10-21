// A `mailto:` link (RFC 6068) as the new message it starts: its addresses, subject and body. The
// link comes from a message a sender wrote, so it is read as text and never trusted to be well
// formed. New code.
import type { MailAddress } from 'ooxml-core/mail';

/** What a `mailto:` link puts in a new message. */
export interface MailtoDraft {
	to: MailAddress[];
	subject: string;
	text: string;
}

/** `text` with its escapes decoded; one that decodes to nothing (`%zz`) leaves it as written. */
function decoded(text: string): string {
	try {
		return decodeURIComponent(text);
	} catch {
		return text;
	}
}

/**
 * The `name=value` fields of a link's query, split at `&` as written and then decoded, names in
 * ASCII lower case (header field names ignore case); the first of a repeated field counts. Read as
 * RFC 6068 writes them, not as a form: a plus sign is itself, never a space.
 */
function fields(query: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const field of query.split('&')) {
		if (!field) continue;
		const at = field.indexOf('=');
		const name = decoded(at < 0 ? field : field.slice(0, at)).replace(/[A-Z]+/g, (run) =>
			run.toLowerCase(),
		);
		if (!out.has(name)) out.set(name, at < 0 ? '' : decoded(field.slice(at + 1)));
	}
	return out;
}

/** The message a `mailto:` link starts, or null for anything else. */
export function mailtoDraft(href: string): MailtoDraft | null {
	let url: URL;
	try {
		url = new URL(href);
	} catch {
		return null;
	}
	if (url.protocol !== 'mailto:') return null;
	// Addresses are split at a comma as written, then decoded: a comma inside one is escaped (%2C).
	const to = url.pathname
		.split(',')
		.map((part) => decoded(part).trim())
		.filter(Boolean)
		.map((email) => ({ name: '', email }));
	const query = fields(url.search.slice(1));
	return { to, subject: query.get('subject') ?? '', text: query.get('body') ?? '' };
}
