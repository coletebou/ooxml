// A parsed message as the mail model's `MailMessage`: the bridge from raw RFC 5322 bytes (an
// imported `.eml`, a transport without JMAP) to what the reading pane shows. New code.
import { previewText, type MailMessage } from '../model';
import { bodyText } from '../search';
import type { ParsedAttachment, ParsedEmail } from './types';

/** What the store knows about a message that its bytes do not say. */
export interface MailMessageMeta {
	id: string;
	threadId: string;
	blobId: string;
	mailboxIds: readonly string[];
	keywords: Readonly<Record<string, true>>;
	receivedAt: number;
	/** The stored size; the raw byte length when missing. */
	size?: number;
}

/**
 * What a `MailMessage` keeps of an HTML body sent in `parts` besides `html` (the parts joined): the
 * parts themselves, only when there are several, as one part is `html` itself. The MIME and the
 * JMAP readers both keep them so.
 */
export const htmlPartsOf = (parts: readonly string[] | null): Pick<MailMessage, 'htmlParts'> =>
	parts && parts.length > 1 ? { htmlParts: parts } : {};

/** An image the HTML body shows itself: not an attachment, and referenced there as `cid:`. */
function isEmbeddedImage(attachment: ParsedAttachment, html: string | null): boolean {
	if (!html || !attachment.cid || attachment.disposition === 'attachment') return false;
	if (!attachment.type.startsWith('image/')) return false;
	return html.toLowerCase().includes(`cid:${attachment.cid.toLowerCase()}`);
}

/**
 * A `MailMessage` from a parsed message and what the store knows about it. `blobIdOf` names the
 * blob each attachment's bytes are kept under. The preview is the text body, else the HTML without
 * tags, scripts or styles, cut as RFC 8621 `preview` is; `hasAttachment` is true when any
 * attachment is more than an image the HTML body shows; an HTML body sent in several parts keeps
 * them (`htmlPartsOf`).
 */
export function toMailMessage(
	parsed: ParsedEmail,
	meta: MailMessageMeta,
	blobIdOf: (partId: string) => string,
): MailMessage {
	const { text, html } = parsed;
	return {
		id: meta.id,
		threadId: meta.threadId,
		blobId: meta.blobId,
		mailboxIds: [...meta.mailboxIds],
		keywords: { ...meta.keywords },
		receivedAt: meta.receivedAt,
		...(parsed.sentAt === undefined ? {} : { sentAt: parsed.sentAt }),
		size: meta.size ?? parsed.size,
		messageId: parsed.messageId,
		inReplyTo: parsed.inReplyTo,
		references: parsed.references,
		from: parsed.from,
		to: parsed.to,
		cc: parsed.cc,
		bcc: parsed.bcc,
		replyTo: parsed.replyTo,
		subject: parsed.subject,
		preview: previewText(bodyText({ text, html })),
		hasAttachment: parsed.attachments.some((attachment) => !isEmbeddedImage(attachment, html)),
		text,
		html,
		...htmlPartsOf(parsed.htmlParts),
		attachments: parsed.attachments.map((attachment) => ({
			partId: attachment.partId,
			blobId: blobIdOf(attachment.partId),
			name: attachment.name,
			type: attachment.type,
			size: attachment.size,
			disposition: attachment.disposition,
			cid: attachment.cid,
		})),
	};
}
