// A `mailto:` link (RFC 6068) as the new message it starts: its addresses (the link's own, then
// those of its `to`, `cc` and `bcc` fields), subject and body. The link comes from a message a
// sender wrote, so it is read as text and never trusted to be well formed. New code.
import { parseAddressList, type MailAddress } from 'ooxml-core/mail';

/** What a `mailto:` link puts in a new message. */
export interface MailtoDraft {
	to: MailAddress[];
	cc: MailAddress[];
	bcc: MailAddress[];
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
 * The `name=value` fields of a link's query in order, split at `&` as written: each name decoded
 * and in ASCII lower case (header field names ignore case), each value as written. Read as RFC 6068
 * writes them, not as a form: a plus sign is itself, never a space.
 */
function fields(query: string): [name: string, value: string][] {
	const out: [string, string][] = [];
	for (const field of query.split('&')) {
		if (!field) continue;
		const at = field.indexOf('=');
		const name = decoded(at < 0 ? field : field.slice(0, at)).replace(/[A-Z]+/g, (run) =>
			run.toLowerCase(),
		);
		out.push([name, at < 0 ? '' : field.slice(at + 1)]);
	}
	return out;
}

/**
 * The addresses of a link's own part or of its `to`, `cc` or `bcc` field. Decoded first, as RFC
 * 6068 5 asks, the value is read as an address list: a comma parts addresses, written or escaped (a
 * link made with `encodeURIComponent` escapes every one), except inside a quoted local part or
 * name. A value with a broken escape (`%zz`) is split at its commas as written instead, each
 * address decoded on its own or kept as written.
 */
function addresses(written: string): MailAddress[] {
	let text: string;
	try {
		text = decodeURIComponent(written);
	} catch {
		return written
			.split(',')
			.map((part) => decoded(part).trim())
			.filter(Boolean)
			.map((email) => ({ name: '', email }));
	}
	return parseAddressList(text).filter((address) => address.email);
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
	const query = fields(url.search.slice(1));
	/** Every address the fields named `name` hold. */
	const all = (name: string): MailAddress[] =>
		query.flatMap(([field, value]) => (field === name ? addresses(value) : []));
	/** The text of the first field named `name`: a repeated subject or body counts once. */
	const first = (name: string): string => {
		const found = query.find(([field]) => field === name);
		return found ? decoded(found[1]) : '';
	};
	return {
		to: [...addresses(url.pathname), ...all('to')],
		cc: all('cc'),
		bcc: all('bcc'),
		subject: first('subject'),
		text: first('body'),
	};
}
