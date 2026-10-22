// A parsed message as the mail model's `MailMessage`: the bridge from raw RFC 5322 bytes (an
// imported `.eml`, a transport without JMAP) to what the reading pane shows. New code.
import { previewText, type MailMessage } from '../model';
import { bodyText, decodeEntities } from '../search';
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

/**
 * A `cid:` URL where the reading pane loads a picture from: a `src` or `background` attribute, or
 * a CSS `url()`, whose quote a `style` attribute may write as a character reference (`&quot;`).
 * A link to a part (`href`), or text naming it, shows nothing.
 */
const PICTURE_CID =
	/(?:[\s"'/](?:src|background)\s*=\s*["']?|url\(\s*(?:["']|&(?:quot|apos|#0*3[49]|#x0*2[27]);)?)cid:([^"'\s>)]+)/gi;

/** `html` without its comments, as an HTML parser reads it: one left open runs to the end. */
function withoutComments(html: string): string {
	let out = '';
	let at = 0;
	for (let open = html.indexOf('<!--'); open >= 0; open = html.indexOf('<!--', at)) {
		out += html.slice(at, open);
		// From the second dash on: `<!-->` and `<!--->` are whole (empty) comments.
		const close = html.indexOf('-->', open + 2);
		if (close < 0) return out;
		at = close + 3;
	}
	return out + html.slice(at);
}

/**
 * The `Content-ID`s (lower case, without angle brackets) of the pictures an HTML body shows, read
 * part by part and each URL with its escapes decoded (RFC 2392) and as written, as the reading
 * pane reads them.
 */
function pictureCids(parts: readonly string[]): Set<string> {
	const cids = new Set<string>();
	const add = (id: string): void => {
		cids.add(id.trim().replace(/^<|>$/g, '').toLowerCase());
	};
	for (const part of parts) {
		for (const [, url] of withoutComments(part).matchAll(PICTURE_CID)) {
			// Up to its closing quote, which a character reference left in the match.
			const written = decodeEntities(url!).split(/["']/, 1)[0]!;
			add(written);
			try {
				add(decodeURIComponent(written));
			} catch {
				// A malformed escape: the URL as written is all there is.
			}
		}
	}
	return cids;
}

/** What tells a picture the body shows from a file: a part's type, disposition and Content-ID. */
type PartKind = Pick<ParsedAttachment, 'cid' | 'disposition' | 'type'>;

/** An image the HTML body shows itself: not an attachment, and a picture there by its `cid:`. */
function isEmbeddedImage(attachment: PartKind, shown: ReadonlySet<string>): boolean {
	if (!attachment.cid || attachment.disposition === 'attachment') return false;
	return attachment.type.startsWith('image/') && shown.has(attachment.cid.toLowerCase());
}

/**
 * True when a message has a file the reading pane lists: a part that is not an image its HTML
 * body (`htmlParts`, the HTML part by part) shows in place as a picture. What `hasAttachment` is,
 * for a message read from its source and for one a store builds.
 */
export function hasListedFile(
	attachments: readonly PartKind[],
	htmlParts: readonly string[],
): boolean {
	const shown = attachments.some((attachment) => attachment.cid)
		? pictureCids(htmlParts)
		: new Set<string>();
	return attachments.some((attachment) => !isEmbeddedImage(attachment, shown));
}

/**
 * A `MailMessage` from a parsed message and what the store knows about it. `blobIdOf` names the
 * blob each attachment's bytes are kept under. The preview is the text body, else the HTML without
 * tags, scripts or styles (read part by part), cut as RFC 8621 `preview` is; `hasAttachment` is
 * true when any attachment is more than an image the HTML body shows as a picture (the files the
 * reading pane lists); an HTML body sent in several parts keeps them (`htmlPartsOf`).
 */
export function toMailMessage(
	parsed: ParsedEmail,
	meta: MailMessageMeta,
	blobIdOf: (partId: string) => string,
): MailMessage {
	const { text, html, htmlParts } = parsed;
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
		preview: previewText(bodyText({ text, html, htmlParts })),
		hasAttachment: hasListedFile(parsed.attachments, htmlParts ?? (html ? [html] : [])),
		text,
		html,
		...htmlPartsOf(htmlParts),
		attachments: parsed.attachments.map((attachment) => ({
			partId: attachment.partId,
			blobId: blobIdOf(attachment.partId),
			name: attachment.name,
			type: attachment.type,
			size: attachment.size,
			disposition: attachment.disposition,
			cid: attachment.cid,
			...(attachment.charset ? { charset: attachment.charset } : {}),
		})),
	};
}
