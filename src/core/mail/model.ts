// Shared types of the `mail` area: accounts, mailboxes, messages, identities and drafts. The shapes
// follow JMAP Mail (RFC 8621) closely, so the memory transport and the JMAP client map onto them one
// to one; times are UTC milliseconds rather than JMAP's date strings. Pure data, no DOM. New code.

/** One address of an address list: `"Ada Lovelace" <ada@example.com>`. */
export interface MailAddress {
	/** The display name; empty when the address has none. */
	name: string;
	email: string;
}

/** The special-use roles of RFC 8621 section 2 (RFC 6154 names) a client gives a place in its UI. */
export type MailboxRole = 'inbox' | 'drafts' | 'sent' | 'archive' | 'junk' | 'trash';
export const MAILBOX_ROLES: readonly MailboxRole[] = [
	'inbox',
	'drafts',
	'sent',
	'archive',
	'junk',
	'trash',
];

export interface Mailbox {
	id: string;
	name: string;
	parentId: string | null;
	/** A special-use role, or `null` for a folder the person made. */
	role: MailboxRole | null;
	sortOrder: number;
	totalEmails: number;
	unreadEmails: number;
}

/** The keywords RFC 8621 section 4.1.1 gives meaning to. Servers may store any other keyword. */
export const SEEN = '$seen';
export const FLAGGED = '$flagged';
export const DRAFT = '$draft';
export const ANSWERED = '$answered';
export const FORWARDED = '$forwarded';

/**
 * What a message list shows: the header fields, keywords and a short preview, without bodies.
 * Address lists and id lists are empty arrays when the header is absent.
 */
export interface EmailSummary {
	id: string;
	/** The transport's thread id (JMAP `threadId`). The list threads by headers itself. */
	threadId: string;
	/** The raw RFC 5322 message, for `.eml` export. */
	blobId: string;
	mailboxIds: readonly string[];
	keywords: Readonly<Record<string, true>>;
	receivedAt: number;
	/** The `Date` header, when present and valid. */
	sentAt?: number;
	size: number;
	/** `Message-ID`, `In-Reply-To` and `References`, without angle brackets. */
	messageId: readonly string[];
	inReplyTo: readonly string[];
	references: readonly string[];
	from: readonly MailAddress[];
	to: readonly MailAddress[];
	cc: readonly MailAddress[];
	bcc: readonly MailAddress[];
	replyTo: readonly MailAddress[];
	subject: string;
	/** Up to 256 characters of body text, white space collapsed. */
	preview: string;
	hasAttachment: boolean;
}

/** A body part a person can open or save (RFC 8621 `EmailBodyPart`, reduced). */
export interface MailAttachment {
	partId: string;
	blobId: string;
	name: string;
	/** The MIME type, lower case (`application/pdf`). */
	type: string;
	size: number;
	disposition: 'attachment' | 'inline' | null;
	/** `Content-ID` without angle brackets, for `cid:` references from the HTML body. */
	cid: string | null;
}

/** A message with its bodies, for the reading pane. */
export interface MailMessage extends EmailSummary {
	/** The plain-text body (text parts joined), or `null` when the message has none. */
	text: string | null;
	/**
	 * The HTML body exactly as sent, or `null`. It is untrusted markup: the UI must sanitise it
	 * before it is shown (scripts, forms, event handlers and remote content). A body sent in several
	 * parts is here as them joined; whatever parses it, or reads its text, reads `htmlParts` instead.
	 */
	html: string | null;
	/**
	 * Set only when the HTML body was sent in several parts (RFC 8621 `htmlBody`, where a plain text
	 * part such as a mailing list footer is escaped into a `<div>`): those parts in order, `html`
	 * being them joined. A reader shows each part on its own, as RFC 8621 asks: parsed as one text,
	 * a part that ends in an open comment or tag would take in the parts after it. Search, previews
	 * and a quote's text read them so too (`bodyText`), as does a quote's or reopened draft's HTML
	 * (`DraftHtml`). Untrusted markup, as `html` is.
	 */
	htmlParts?: readonly string[];
	attachments: readonly MailAttachment[];
	/**
	 * Set when the transport sent only the start of a long body, enough to show it. Quoting or
	 * editing needs the whole message: read it again with `{ whole: true }`.
	 */
	truncated?: true;
}

/** Who a person can send as (RFC 8621 `Identity`). */
export interface Identity {
	id: string;
	name: string;
	/** The address, or `*@domain` for any address of that domain (RFC 8621 section 6). */
	email: string;
	replyTo: readonly MailAddress[];
	bcc: readonly MailAddress[];
	textSignature: string;
	htmlSignature: string;
}

export interface MailAccount {
	id: string;
	/** What the server calls the account, often the login address. */
	name: string;
}

/** A file already uploaded through the transport, ready to attach to a draft. */
export interface DraftAttachment {
	blobId: string;
	name: string;
	type: string;
	size: number;
	/** `Content-ID` without angle brackets, for `cid:` references from the HTML body. */
	cid?: string;
	/** Shown in the body rather than listed (`Content-Disposition: inline`). */
	inline?: boolean;
}

/** What the compose window edits and the transport saves or sends. */
export interface Draft {
	/** The saved draft's email id, once it has been saved. */
	id?: string;
	identityId?: string;
	/**
	 * The From address. Unset, the transport writes the identity's own; a `*@domain` identity has
	 * none, so a real address of its domain goes here, never the wildcard.
	 */
	from?: MailAddress;
	to: readonly MailAddress[];
	cc: readonly MailAddress[];
	bcc: readonly MailAddress[];
	subject: string;
	/** The plain-text body. Always sent, as the only part or the `text/plain` alternative. */
	text: string;
	/** The rich body, already sanitised by the editor; sent as the `text/html` alternative. */
	html?: string;
	attachments: readonly DraftAttachment[];
	inReplyTo?: readonly string[];
	references?: readonly string[];
	/** The message this answers or forwards, which gets `$answered` or `$forwarded` once sent. */
	replyToEmailId?: string;
	forwardOfEmailId?: string;
}

export const MAX_PREVIEW_CHARS = 256;

/** Collapse white space and cut to the preview length, the way RFC 8621 `preview` reads. */
export function previewText(text: string, max = MAX_PREVIEW_CHARS): string {
	const flat = text.replace(/\s+/g, ' ').trim();
	return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}\u2026`;
}

export function hasKeyword(email: Pick<EmailSummary, 'keywords'>, keyword: string): boolean {
	return email.keywords[keyword] === true;
}

/** `"Ada Lovelace" <ada@example.com>`, or the bare address when there is no name. */
export function formatAddress(address: MailAddress): string {
	if (!address.name) return address.email;
	const name = /[",.:;<>@()[\]\\]/.test(address.name)
		? `"${address.name.replace(/(["\\])/g, '\\$1')}"`
		: address.name;
	return `${name} <${address.email}>`;
}

/** The name to show for an address: its display name, else the local part of the address. */
export function displayName(address: MailAddress): string {
	return address.name || address.email.split('@')[0] || address.email;
}

/** True when two addresses name the same mailbox (domain case-insensitive, local part too). */
export function sameAddress(a: MailAddress | string, b: MailAddress | string): boolean {
	const left = typeof a === 'string' ? a : a.email;
	const right = typeof b === 'string' ? b : b.email;
	return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/** True for the `*@domain` of an identity that may write as any address of a domain. */
export const isWildcardAddress = (email: string): boolean => email.trim().startsWith('*@');

/** True when `identity` may write as `email`: the same address, or `*@domain` for its domain. */
export function identityCovers(identity: Identity, email: string): boolean {
	const own = identity.email.trim().toLowerCase();
	const address = email.trim().toLowerCase();
	return isWildcardAddress(own) ? address.endsWith(own.slice(1)) : sameAddress(own, address);
}

/**
 * The identity that may write as one of `addresses`, tried in order: one with exactly that address
 * first, else a `*@domain` one covering it. `undefined` when none does.
 */
export function identityFor(
	identities: readonly Identity[],
	addresses: readonly MailAddress[],
): Identity | undefined {
	for (const address of addresses) {
		const exact = identities.find((identity) => sameAddress(identity.email, address));
		if (exact) return exact;
	}
	for (const address of addresses) {
		const covering = identities.find((identity) => identityCovers(identity, address.email));
		if (covering) return covering;
	}
	return undefined;
}
