// JMAP objects to the `mail` model (RFC 8621 Mailbox, Email, EmailBodyPart, Identity) and back for
// addresses. The server is untrusted, so each value is checked: dates become UTC milliseconds,
// `null` lists empty lists, a `null` display name '', an unknown mailbox role `null`. Bodies and
// attachment names are read as the MIME reader reads them. New code.
import { cleanFileName } from '../mime/file-names';
import { textCharset } from '../mime/parse';
import { htmlPartsOf } from '../mime/message';
import { htmlBodyPart } from '../mime/structure';
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

type Part = Record<string, unknown>;

/** The object items of a body part list. */
const records = (value: unknown): Part[] => list(value).filter(isRecord);
const typeOf = (part: Part): string => text(part.type).toLowerCase();
const isText = (type: string): boolean => type === 'text/plain' || type === 'text/html';

/** Parts shown one after another: a line break between two when the first does not end one. */
const joinParts = (parts: readonly string[]): string =>
	parts.reduce((out, part) => (!out || out.endsWith('\n') ? out + part : `${out}\n${part}`), '');

/** The values the server fetched for the body parts of an Email, by partId. */
const bodyValues = (email: JmapObject): Record<string, unknown> =>
	isRecord(email.bodyValues) ? email.bodyValues : {};

/** The value the server fetched for a body part, `null` when it sent none. */
function valueOf(part: Part, values: Record<string, unknown>): string | null {
	const partId = text(part.partId);
	const value = Object.hasOwn(values, partId) ? values[partId] : undefined;
	return isRecord(value) && typeof value.value === 'string' ? value.value : null;
}

/**
 * The `text/plain` values of `textBody`, joined; `null` when there are none, or when `textBody`
 * holds HTML too (RFC 8621 lists the HTML of a message with no plain alternative there): its plain
 * parts alone, a mailing list footer say, are not the message then, and its HTML body is.
 */
function textOf(body: readonly Part[], values: Record<string, unknown>): string | null {
	if (body.some((part) => typeOf(part) === 'text/html')) return null;
	const found = body.flatMap((part) => {
		const value = typeOf(part) === 'text/plain' ? valueOf(part, values) : null;
		return value === null ? [] : [value];
	});
	return found.length ? joinParts(found) : null;
}

/**
 * `htmlBody` part by part, in order: its `text/html` values as they are and its `text/plain` ones
 * (RFC 8621 lists plain text such as a mailing list footer there too) escaped, as the MIME reader
 * keeps them (`messageBodies`); `null` without an HTML value. A reader shows each part on its own:
 * parsed as one text, a part that ends in an open comment or tag would take in the parts after it.
 */
export function htmlBodyParts(email: JmapObject): string[] | null {
	const values = bodyValues(email);
	const parts: string[] = [];
	let html = false;
	for (const part of records(email.htmlBody)) {
		const type = typeOf(part);
		const value = isText(type) ? valueOf(part, values) : null;
		if (value === null) continue;
		html ||= type === 'text/html';
		parts.push(htmlBodyPart(type, value));
	}
	return html ? parts : null;
}

export function toAttachment(part: Record<string, unknown>): MailAttachment {
	const disposition = text(part.disposition).toLowerCase();
	const cid = text(part.cid);
	return {
		partId: text(part.partId),
		blobId: text(part.blobId),
		// Cleaned as the MIME reader cleans it: no directories, control or bidirectional characters.
		name: cleanFileName(text(part.name)) ?? '',
		type: text(part.type).toLowerCase() || 'application/octet-stream',
		size: count(part.size),
		disposition: disposition === 'inline' ? 'inline' : disposition ? 'attachment' : null,
		cid: cid ? unbracket(cid) : null,
		...textCharset(text(part.type).toLowerCase(), text(part.charset) || undefined),
	};
}

/**
 * Every downloadable part of `attachments`, then the parts the bodies show that a string cannot
 * carry: images, audio and video between the text, which RFC 8621 leaves out of `attachments`
 * when both bodies show them. They come last, as JMAP does not say where among the attachments
 * they sit; each part is listed once.
 */
function attachmentsOf(email: JmapObject): MailAttachment[] {
	// A part is its partId; the blob stands in on a server that leaves the id out.
	const key = (part: Part): string => text(part.partId) || `blob:${text(part.blobId)}`;
	const found = records(email.attachments);
	const listed = new Set(found.map(key));
	for (const part of [...records(email.textBody), ...records(email.htmlBody)]) {
		if (isText(typeOf(part)) || listed.has(key(part))) continue;
		listed.add(key(part));
		found.push(part);
	}
	return found.filter((part) => !!text(part.blobId)).map(toAttachment);
}

/**
 * A message with its bodies, read as the MIME reader reads the same message: `text` is the
 * `text/plain` values of `textBody` (none when it holds HTML), `html` the parts of `htmlBody`
 * joined (`htmlBodyParts`, `null` without an HTML value) and `htmlParts` those parts when there
 * are several (`htmlPartsOf`), `attachments` the downloadable parts of `attachments` and the
 * media the bodies show.
 */
export function toMessage(email: JmapObject): MailMessage {
	const parts = htmlBodyParts(email);
	return {
		...toSummary(email),
		text: textOf(records(email.textBody), bodyValues(email)),
		html: parts?.join('') ?? null,
		...htmlPartsOf(parts),
		attachments: attachmentsOf(email),
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
