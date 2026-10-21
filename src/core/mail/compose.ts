// New, reply, reply all and forward: who a draft goes to and is from, its subject, the
// `In-Reply-To` and `References` that thread it (RFC 5322 section 3.6.4), the quoted original and
// the parts a forward carries; a saved draft read back to edit; whether a draft holds anything. The
// words around a quote ("On ... Ada wrote:") are the UI's, passed in through `QuoteFormat`, so they
// are localised. The UI passes in the HTML a quote or a reopened draft holds too (`DraftHtml`):
// cleaning a body part by part takes an HTML parser, which this area has none of. New code.
import { textToHtml } from './mime/structure';
import {
	formatAddress,
	identityCovers,
	isWildcardAddress,
	sameAddress,
	type Draft,
	type DraftAttachment,
	type Identity,
	type MailAddress,
	type MailAttachment,
	type MailMessage,
} from './model';
import { bodyText, dropScriptsAndStyles } from './search';
import { forwardSubject, replySubject } from './subject';
import { messageDate } from './threading';

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward';

/** The localised text a quote is wrapped in. */
export interface QuoteFormat {
	/** The line above a quoted reply: `On Mon, 5 Jan 2026 at 09:00, Ada <ada@example.com> wrote:`. */
	attribution(source: MailMessage): string;
	/** The header block of a forwarded message, one line each (`From: ...`, `Subject: ...`). */
	forwardHeader(source: MailMessage): readonly string[];
}

/** English quote wording, for clients without a localised `quoteFormat`. */
export const ENGLISH_QUOTE_FORMAT: QuoteFormat = {
	attribution: (source) =>
		`On ${new Date(messageDate(source)).toUTCString()}, ${source.from[0] ? formatAddress(source.from[0]) : 'someone'} wrote:`,
	forwardHeader: (source) => [
		'---------- Forwarded message ----------',
		`From: ${source.from.map(formatAddress).join(', ')}`,
		`Date: ${new Date(messageDate(source)).toUTCString()}`,
		`Subject: ${source.subject}`,
		`To: ${source.to.map(formatAddress).join(', ')}`,
		...(source.cc.length ? [`Cc: ${source.cc.map(formatAddress).join(', ')}`] : []),
	],
};

/**
 * A message's HTML body as a draft holds it (a reply's or forward's quote, or a saved draft opened
 * again), or null when it has none. Where HTML can be parsed (a UI), pass one that cleans each part
 * of `message.htmlParts` on its own and joins them: read as one text, a part that ends in an open
 * comment or tag takes in the parts after it. `parts` are the message's parts the draft carries,
 * whose `cid:` pictures stay (the others go). Without one, a draft holds `message.html` as sent.
 */
export type DraftHtml = (message: MailMessage, parts: readonly DraftAttachment[]) => string | null;

/**
 * A message's HTML as a draft carrying `parts` holds it: what `draftHtml` makes of it, else the
 * HTML as sent.
 */
const heldHtml = (
	message: MailMessage,
	parts: readonly DraftAttachment[],
	draftHtml: DraftHtml | undefined,
): string | null => (draftHtml ? draftHtml(message, parts) : message.html);

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

/**
 * The address a draft is written from: the identity's own, or for a `*@domain` identity the
 * address of that domain the original was written to (To, then Cc, then Bcc), else, for a message
 * the person `sent`, the one it was written from (RFC 8621 section 6 lets such an identity send
 * from any address of the domain). A wildcard is never an address to write from, so without such
 * an original there is none.
 */
function sender(
	identity: Identity | null,
	source: MailMessage | null,
	sent: boolean,
): MailAddress | undefined {
	if (!identity) return undefined;
	if (!isWildcardAddress(identity.email)) return { name: identity.name, email: identity.email };
	const own = source && sent ? source.from : [];
	const addresses = source ? [...source.to, ...source.cc, ...source.bcc, ...own] : [];
	const covered = addresses.find((address) => identityCovers(identity, address.email));
	return covered ? { name: identity.name, email: covered.email } : undefined;
}

/**
 * A message's part as a draft refers to it: by the blob the server already holds, with its
 * `Content-ID` and, when it is shown in the body, its inline disposition. A part with a
 * `Content-ID` and no disposition (a picture of a `multipart/related`) counts as inline.
 */
function draftAttachment(attachment: MailAttachment): DraftAttachment {
	const { blobId, name, type, size, cid, disposition } = attachment;
	const inline = disposition === 'inline' || (disposition === null && !!cid);
	return { blobId, name, type, size, ...(cid ? { cid } : {}), ...(inline ? { inline } : {}) };
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
	/** The original's HTML as the quote holds it; without it, the HTML as sent (`DraftHtml`). */
	draftHtml?: DraftHtml;
	/**
	 * The original is a message the person sent, as the client knows from its folder (Sent). Only
	 * then is its From one of their addresses, which a `*@domain` identity answers from when the
	 * original was written to no address of that domain. A received message's From never is: one
	 * from a colleague at that domain is theirs.
	 */
	sent?: boolean;
}

/**
 * A draft for `mode`. Without `draftHtml`, the quoted HTML holds the original's HTML as sent, so
 * it is as untrusted as the original: the editor must sanitise `draft.html` before it shows it.
 */
export function composeDraft(
	mode: ComposeMode,
	source: MailMessage | null,
	options: ComposeOptions,
): Draft {
	const from = sender(options.identity, mode === 'new' ? null : source, options.sent === true);
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
	/** The original as the quote of a draft carrying `parts` holds it: its HTML, else its text. */
	const quoted = (parts: readonly DraftAttachment[]): string =>
		heldHtml(source, parts, options.draftHtml) ?? textToHtml(original);
	if (mode === 'forward') {
		const header = options.format.forwardHeader(source);
		// Every part, the pictures the copied HTML shows by `cid:` too, so they still show.
		const attachments = source.attachments.map(draftAttachment);
		return {
			...base,
			subject: forwardSubject(source.subject),
			text: `\n\n${header.join('\n')}\n\n${original}`,
			html: `<p><br></p><div>${header.map(textToHtml).join('<br>')}</div><br>${quoted(attachments)}`,
			attachments,
			references: answerReferences(source),
			forwardOfEmailId: source.id,
		};
	}
	// The address it is written from is the person's own too: for a wildcard identity, `me` lacks it.
	const { to, cc } = replyRecipients(source, mode, from ? [...options.me, from] : options.me);
	const attribution = options.format.attribution(source);
	const inReplyTo = source.messageId.slice(0, 1);
	return {
		...base,
		to,
		cc,
		subject: replySubject(source.subject),
		text: `\n\n${attribution}\n${quoteText(original)}`,
		// An answer carries none of the original's parts, so its quote shows none of their pictures.
		html: `<p><br></p><div>${textToHtml(attribution)}</div><blockquote type="cite">${quoted([])}</blockquote>`,
		...(inReplyTo.length ? { inReplyTo } : {}),
		references: answerReferences(source),
		replyToEmailId: source.id,
	};
}

/**
 * A saved draft, as the server holds it, to edit again; `identity` is the one it is from, and its
 * HTML is what `draftHtml` makes of the message's (as saved without it). One saved with only HTML
 * gets a plain text made from it, since a draft always sends one.
 */
export function draftFromMessage(
	message: MailMessage,
	identity: Identity | undefined,
	draftHtml?: DraftHtml,
): Draft {
	const from = message.from[0];
	const attachments = message.attachments.map(draftAttachment);
	const html = heldHtml(message, attachments, draftHtml);
	return {
		id: message.id,
		...(identity ? { identityId: identity.id } : {}),
		...(from ? { from } : {}),
		to: message.to,
		cc: message.cc,
		bcc: message.bcc,
		subject: message.subject,
		text: bodyText({ text: message.text, html: message.html, htmlParts: message.htmlParts }),
		...(html ? { html } : {}),
		attachments,
		inReplyTo: message.inReplyTo,
		references: message.references,
	};
}

/**
 * `draft` with a host's `patch` (`MailClient.updateDraft`). A new text without HTML leaves out an
 * HTML the host did not give (`hostHtml` false: an answer's or a forward's quote, a reopened
 * draft's): it still says what the text said before, and a reader shows one alternative or the
 * other (RFC 2046 5.1.4), so the message goes as its text alone. HTML the host gave, in `patch` or
 * before, is its own and stays.
 */
export function patchDraft(
	draft: Draft,
	patch: Partial<Omit<Draft, 'id' | 'attachments'>>,
	hostHtml: boolean,
): Draft {
	const next = { ...draft, ...patch };
	const retext = patch.text !== undefined && patch.text !== draft.text;
	if (retext && !hostHtml && !('html' in patch)) delete next.html;
	return next;
}

/** Markup that shows something without any text: a picture or other media. */
const MEDIA = /<(?:img|picture|svg|video|audio|canvas|object|embed)\b/i;

/** True when `html` shows anything: text or media, not just an empty editor's `<p><br></p>`. */
const hasContent = (html: string | undefined): boolean =>
	!!html && (MEDIA.test(dropScriptsAndStyles(html)) || !!bodyText({ html }).trim());

/**
 * True when a draft has nothing worth keeping: no To or Cc recipients, subject, text, formatted
 * text or files. Bcc is not counted, since a new draft starts with the identity's own Bcc addresses.
 */
export function isEmptyDraft(draft: Draft): boolean {
	return (
		!draft.to.length &&
		!draft.cc.length &&
		!draft.subject.trim() &&
		!draft.text.trim() &&
		!draft.attachments.length &&
		!hasContent(draft.html)
	);
}

/** Every recipient of a draft, for validation before sending. */
export const draftRecipients = (draft: Draft): MailAddress[] => [
	...draft.to,
	...draft.cc,
	...draft.bcc,
];
