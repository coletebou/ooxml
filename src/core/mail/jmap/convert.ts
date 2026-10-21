// JMAP objects to the `mail` model (RFC 8621 Mailbox, Email, EmailBodyPart, Identity) and back for
// addresses. The server is untrusted, so each value is checked: dates become UTC milliseconds,
// `null` lists empty lists, a `null` display name '', an unknown mailbox role `null`. New code.
import {
	MAILBOX_ROLES,
	type EmailSummary,
	type Identity,
	type MailAddress,
	type MailAttachment,
	type Mailbox,
	type MailboxRole,
	type MailMessage,
} from '../model';
import { isRecord, type JmapEmailAddress } from './types';

/** A JSON object with a string `id`, the only shape a /get `list` item is trusted to have. */
export type JmapObject = Record<string, unknown> & { id: string };

const text = (value: unknown, fallback = ''): string =>
	typeof value === 'string' ? value : fallback;
const count = (value: unknown): number =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const unbracket = (id: string): string => id.replace(/^<|>$/g, '');

/** The string items of a list (ids, say); a value that is not a list has none. */
export const strings = (value: unknown): string[] =>
	list(value).filter((item): item is string => typeof item === 'string');

/** The items of a /get `list` (or any list) that are objects with an id. */
export function objects(value: unknown): JmapObject[] {
	return list(value).filter(
		(item): item is JmapObject => isRecord(item) && typeof item.id === 'string',
	);
}

/** Milliseconds of a Date or UTCDate (RFC 8620 1.4), `undefined` when it is not one. */
export function fromJmapDate(value: unknown): number | undefined {
	if (typeof value !== 'string') return undefined;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? undefined : ms;
}

/** `EmailAddress[] | null` to addresses: `null` is `[]`, a `null` name ''. */
export function toAddresses(value: unknown): MailAddress[] {
	return list(value).flatMap((item) =>
		isRecord(item) && typeof item.email === 'string'
			? [{ name: text(item.name), email: item.email }]
			: [],
	);
}

/** Addresses for an Email to create: an empty display name is sent as `null`. */
export function toJmapAddresses(addresses: readonly MailAddress[]): JmapEmailAddress[] {
	return addresses.map((address) => ({ name: address.name || null, email: address.email }));
}

const ROLES: ReadonlySet<string> = new Set(MAILBOX_ROLES);

/** A role the model knows, or `null` (no role, or one such as `important` it does not). */
export function toMailboxRole(value: unknown): MailboxRole | null {
	const role = text(value).toLowerCase();
	return ROLES.has(role) ? (role as MailboxRole) : null;
}

export function toMailbox(mailbox: JmapObject): Mailbox {
	return {
		id: mailbox.id,
		name: text(mailbox.name),
		parentId: typeof mailbox.parentId === 'string' ? mailbox.parentId : null,
		role: toMailboxRole(mailbox.role),
		sortOrder: count(mailbox.sortOrder),
		totalEmails: count(mailbox.totalEmails),
		unreadEmails: count(mailbox.unreadEmails),
	};
}

const trueKeys = (value: unknown): string[] =>
	isRecord(value) ? Object.keys(value).filter((key) => value[key] === true) : [];

const messageIds = (value: unknown): string[] =>
	list(value).flatMap((id) => (typeof id === 'string' && id ? [unbracket(id)] : []));

export function toSummary(email: JmapObject): EmailSummary {
	const sentAt = fromJmapDate(email.sentAt);
	return {
		id: email.id,
		threadId: text(email.threadId),
		blobId: text(email.blobId),
		mailboxIds: trueKeys(email.mailboxIds),
		keywords: Object.fromEntries(
			trueKeys(email.keywords).map((keyword) => [keyword.toLowerCase(), true as const]),
		),
		receivedAt: fromJmapDate(email.receivedAt) ?? 0,
		...(sentAt === undefined ? {} : { sentAt }),
		size: count(email.size),
		messageId: messageIds(email.messageId),
		inReplyTo: messageIds(email.inReplyTo),
		references: messageIds(email.references),
		from: toAddresses(email.from),
		to: toAddresses(email.to),
		cc: toAddresses(email.cc),
		bcc: toAddresses(email.bcc),
		replyTo: toAddresses(email.replyTo),
		subject: text(email.subject),
		preview: text(email.preview),
		hasAttachment: email.hasAttachment === true,
	};
}

/** Parts shown one after another: a line break between two when the first does not end one. */
const joinParts = (parts: readonly string[]): string =>
	parts.reduce((out, part) => (!out || out.endsWith('\n') ? out + part : `${out}\n${part}`), '');

/** The fetched values of the `type` parts of a body part list, joined; `null` when none. */
function bodyOf(parts: unknown, values: Record<string, unknown>, type: string): string | null {
	const found: string[] = [];
	for (const part of list(parts)) {
		if (!isRecord(part) || text(part.type).toLowerCase() !== type) continue;
		const partId = text(part.partId);
		const value = Object.hasOwn(values, partId) ? values[partId] : undefined;
		if (isRecord(value) && typeof value.value === 'string') found.push(value.value);
	}
	return found.length ? joinParts(found) : null;
}

export function toAttachment(part: Record<string, unknown>): MailAttachment {
	const disposition = text(part.disposition).toLowerCase();
	const cid = text(part.cid);
	return {
		partId: text(part.partId),
		blobId: text(part.blobId),
		name: text(part.name),
		type: text(part.type).toLowerCase() || 'application/octet-stream',
		size: count(part.size),
		disposition: disposition === 'inline' ? 'inline' : disposition ? 'attachment' : null,
		cid: cid ? unbracket(cid) : null,
	};
}

/**
 * A message with its bodies: `text` is the `text/plain` values of `textBody`, `html` the
 * `text/html` values of `htmlBody` (`null` without an HTML part), `attachments` every part of
 * `attachments` that can be downloaded.
 */
export function toMessage(email: JmapObject): MailMessage {
	const values = isRecord(email.bodyValues) ? email.bodyValues : {};
	return {
		...toSummary(email),
		text: bodyOf(email.textBody, values, 'text/plain'),
		html: bodyOf(email.htmlBody, values, 'text/html'),
		attachments: list(email.attachments)
			.filter((part): part is Record<string, unknown> => isRecord(part) && !!text(part.blobId))
			.map(toAttachment),
	};
}

export function toIdentity(identity: JmapObject): Identity {
	return {
		id: identity.id,
		name: text(identity.name),
		email: text(identity.email),
		replyTo: toAddresses(identity.replyTo),
		bcc: toAddresses(identity.bcc),
		textSignature: text(identity.textSignature),
		htmlSignature: text(identity.htmlSignature),
	};
}
