// The shapes a parsed message takes: its MIME tree, its attachments and the message itself, with
// the RFC 8621 reading of its headers and bodies. New code.
import type { MailAddress } from '../model';
import type { HeaderField } from './headers';

/** One entity of a message's MIME tree (RFC 2045, RFC 2046). */
export interface MimePart {
	/**
	 * The IMAP section number of the part (RFC 3501): `1`, `1.2`, `2.1.3`. The body of a message
	 * that is not multipart is `1`; a top-level multipart, which IMAP leaves unnumbered, is `TEXT`,
	 * and the one of a message attached as part `2` is `2.TEXT`.
	 */
	partId: string;
	headers: readonly HeaderField[];
	/** The media type in lower case: `text/plain`. */
	type: string;
	params: Readonly<Record<string, string>>;
	disposition: 'inline' | 'attachment' | null;
	/** The file name (`filename`, else the content type's `name`), decoded, without directories. */
	name: string | null;
	/** `Content-ID` without angle brackets. */
	cid: string | null;
	/**
	 * The content without its transfer encoding; empty for a multipart. Content that had no transfer
	 * encoding is a view of the raw message, not a copy: read it through the view, not `.buffer`.
	 */
	body: Uint8Array;
	/** The body parts of a multipart; empty otherwise. */
	parts: readonly MimePart[];
	/** The message inside a `message/rfc822` part, whose bytes are also its `body`; else `null`. */
	message: ParsedEmail | null;
}

/** A part to list as an attachment (RFC 8621 `attachments`), with its decoded bytes. */
export interface ParsedAttachment {
	partId: string;
	/** The part's file name, else one made up: `attachment-2.png`, or the subject for a message. */
	name: string;
	type: string;
	/** The decoded size in bytes. */
	size: number;
	disposition: 'attachment' | 'inline' | null;
	cid: string | null;
	/** The charset of a text file (`iso-8859-1`), lower case: its bytes are read in it. */
	charset?: string;
	/** The part's `body`: possibly a view of the raw message, so read it, not its `.buffer`. */
	bytes: Uint8Array;
}

/** A message read from raw bytes. Address and id lists are empty when the header is missing. */
export interface ParsedEmail {
	headers: readonly HeaderField[];
	/** `Message-ID`, `In-Reply-To` and `References`, without angle brackets. */
	messageId: string[];
	inReplyTo: string[];
	references: string[];
	from: MailAddress[];
	sender: MailAddress[];
	to: MailAddress[];
	cc: MailAddress[];
	bcc: MailAddress[];
	replyTo: MailAddress[];
	/** The decoded subject. */
	subject: string;
	/** The `Date` header in UTC milliseconds, when present and readable. */
	sentAt: number | undefined;
	/** The text bodies joined (RFC 8621 `textBody`), line breaks as LF; `null` without one. */
	text: string | null;
	/**
	 * The HTML body (RFC 8621 `htmlBody`) as one text, `htmlParts` joined; line breaks as LF;
	 * untrusted markup; `null` without one.
	 */
	html: string | null;
	/**
	 * The HTML body part by part, each to be shown on its own: parsed as one text, a part that ends
	 * in an open comment or tag would take in the parts after it. `null` without an HTML body.
	 */
	htmlParts: string[] | null;
	attachments: ParsedAttachment[];
	root: MimePart;
	/** The raw size in bytes. */
	size: number;
}
