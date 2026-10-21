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
	return {
		to,
		subject: url.searchParams.get('subject') ?? '',
		text: url.searchParams.get('body') ?? '',
	};
}
