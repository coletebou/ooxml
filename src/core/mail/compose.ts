// New, reply, reply all and forward: who a draft goes to, its subject, the `In-Reply-To` and
// `References` that thread it (RFC 5322 section 3.6.4) and the quoted original. The words around a
// quote ("On ... Ada wrote:") are the UI's, passed in through `QuoteFormat`, so they are localised.
// New code.
import { textToHtml } from './mime/structure';
import {
	sameAddress,
	type Draft,
	type Identity,
	type MailAddress,
	type MailMessage,
} from './model';
import { bodyText } from './search';
import { forwardSubject, replySubject } from './subject';

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward';

/** The localised text a quote is wrapped in. */
export interface QuoteFormat {
	/** The line above a quoted reply: `On Mon, 5 Jan 2026 at 09:00, Ada <ada@example.com> wrote:`. */
	attribution(source: MailMessage): string;
	/** The header block of a forwarded message, one line each (`From: ...`, `Subject: ...`). */
	forwardHeader(source: MailMessage): readonly string[];
}

const unique = (list: readonly MailAddress[], exclude: readonly MailAddress[]): MailAddress[] => {
	const out: MailAddress[] = [];
	for (const address of list) {
		if (!address.email) continue;
		if (exclude.some((other) => sameAddress(other, address))) continue;
		if (out.some((other) => sameAddress(other, address))) continue;
		out.push(address);
	}
	return out;
};

function quoteText(text: string): string {
	return text
		.replace(/\r\n/g, '\n')
		.split('\n')
		.map((line) => (line.startsWith('>') ? `>${line}` : `> ${line}`))
		.join('\n');
}

/** The address a draft is written from: the chosen identity's, if there is one. */
function sender(identity: Identity | null): MailAddress | undefined {
	return identity ? { name: identity.name, email: identity.email } : undefined;
}

/**
 * Recipients of a reply: the original's `Reply-To` (else `From`), or, when the person answers a
 * message they sent themselves, its recipients. Reply all adds the other `To` and `Cc` people.
 */
export function replyRecipients(
	source: MailMessage,
	mode: 'reply' | 'replyAll',
	me: readonly MailAddress[],
): { to: MailAddress[]; cc: MailAddress[] } {
	const fromMe = source.from.some((address) => me.some((own) => sameAddress(own, address)));
	const primary = fromMe ? source.to : source.replyTo.length ? source.replyTo : source.from;
	if (mode === 'reply') return { to: unique(primary, fromMe ? me : []), cc: [] };
	const to = unique([...primary, ...(fromMe ? [] : source.to)], me);
	const cc = unique(source.cc, [...me, ...to]);
	return { to: to.length ? to : unique(primary, []), cc };
}

/** `References` of an answer: the original's references, then its own id (RFC 5322 3.6.4). */
export function answerReferences(source: MailMessage): string[] {
	const own = source.messageId[0];
	const base = source.references.length ? source.references : source.inReplyTo.slice(0, 1);
	return own ? [...base.filter((id) => id !== own), own] : [...base];
}

export interface ComposeOptions {
	identity: Identity | null;
	/** Every address of the person, so a reply all never copies them in. */
	me: readonly MailAddress[];
	format: QuoteFormat;
}

/**
 * A draft for `mode`. The quoted HTML holds the original's HTML as sent, so it is as untrusted as
 * the original: the editor must sanitise `draft.html` before it shows it.
 */
export function composeDraft(
	mode: ComposeMode,
	source: MailMessage | null,
	options: ComposeOptions,
): Draft {
	const from = sender(options.identity);
	const base: Draft = {
		...(options.identity ? { identityId: options.identity.id } : {}),
		...(from ? { from } : {}),
		to: [],
		cc: [],
		bcc: options.identity ? [...options.identity.bcc] : [],
		subject: '',
		text: '',
		attachments: [],
	};
	if (mode === 'new' || !source) return base;
	const original = bodyText(source);
	if (mode === 'forward') {
		const header = options.format.forwardHeader(source);
		return {
			...base,
			subject: forwardSubject(source.subject),
			text: `\n\n${header.join('\n')}\n\n${original}`,
			html: `<p><br></p><div>${header.map(textToHtml).join('<br>')}</div><br>${source.html ?? textToHtml(original)}`,
			attachments: source.attachments
				.filter((attachment) => attachment.disposition !== 'inline' || !attachment.cid)
				.map(({ blobId, name, type, size }) => ({ blobId, name, type, size })),
			references: answerReferences(source),
			forwardOfEmailId: source.id,
		};
	}
	const { to, cc } = replyRecipients(source, mode, options.me);
	const attribution = options.format.attribution(source);
	const inReplyTo = source.messageId.slice(0, 1);
	return {
		...base,
		to,
		cc,
		subject: replySubject(source.subject),
		text: `\n\n${attribution}\n${quoteText(original)}`,
		html: `<p><br></p><div>${textToHtml(attribution)}</div><blockquote type="cite">${source.html ?? textToHtml(original)}</blockquote>`,
		...(inReplyTo.length ? { inReplyTo } : {}),
		references: answerReferences(source),
		replyToEmailId: source.id,
	};
}

/**
 * True when a draft has nothing worth keeping: no To or Cc recipients, subject, text or files.
 * Bcc is not counted, since a new draft starts with the identity's own Bcc addresses.
 */
export function isEmptyDraft(draft: Draft): boolean {
	return (
		!draft.to.length &&
		!draft.cc.length &&
		!draft.subject.trim() &&
		!draft.text.trim() &&
		!draft.attachments.length
	);
}

/** Every recipient of a draft, for validation before sending. */
export const draftRecipients = (draft: Draft): MailAddress[] => [
	...draft.to,
	...draft.cc,
	...draft.bcc,
];
