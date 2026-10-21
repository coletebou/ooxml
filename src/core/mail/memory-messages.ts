// The message records the memory transport keeps, and how a seed, a draft or an imported `.eml`
// becomes one. Separate from the transport so the rules (counts, previews, thread ids) are testable
// on their own. New code.
import { readEmail, toMailMessage, writeEmail, type OutgoingAttachment } from './mime';
import { plainText } from './mime/build';
import { hasListedFile } from './mime/message';
import {
	DRAFT,
	FLAGGED,
	SEEN,
	previewText,
	type Draft,
	type MailAddress,
	type MailAttachment,
	type Mailbox,
	type MailboxRole,
	type MailMessage,
} from './model';
import { bodyText } from './search';

/** A message to put in a memory transport: the fields a person would see, plus where it lives. */
export interface SeedMessage {
	id?: string;
	mailboxId: string;
	from: MailAddress;
	to?: readonly MailAddress[];
	cc?: readonly MailAddress[];
	bcc?: readonly MailAddress[];
	replyTo?: readonly MailAddress[];
	subject: string;
	text?: string;
	html?: string;
	attachments?: readonly OutgoingAttachment[];
	messageId?: string;
	inReplyTo?: readonly string[];
	references?: readonly string[];
	receivedAt: number;
	sentAt?: number;
	unread?: boolean;
	flagged?: boolean;
	keywords?: readonly string[];
}

export interface SeedMailbox {
	id: string;
	name: string;
	role?: MailboxRole | null;
	parentId?: string | null;
	sortOrder?: number;
}

/** The standard folders, in the order a folder pane lists them. */
export const DEFAULT_MAILBOXES: readonly SeedMailbox[] = [
	{ id: 'inbox', name: 'Inbox', role: 'inbox', sortOrder: 1 },
	{ id: 'drafts', name: 'Drafts', role: 'drafts', sortOrder: 2 },
	{ id: 'sent', name: 'Sent', role: 'sent', sortOrder: 3 },
	{ id: 'archive', name: 'Archive', role: 'archive', sortOrder: 4 },
	{ id: 'junk', name: 'Junk', role: 'junk', sortOrder: 5 },
	{ id: 'trash', name: 'Trash', role: 'trash', sortOrder: 6 },
];

export interface StoredBlob {
	bytes: Uint8Array;
	type: string;
}

/** Where blob bytes live, keyed by blob id; the raw message blob is produced on demand. */
export type BlobStore = Map<string, StoredBlob>;

const keywordsOf = (list: readonly string[]): Record<string, true> =>
	Object.fromEntries(list.map((keyword) => [keyword, true as const]));

export function mailboxOf(seed: SeedMailbox): Mailbox {
	return {
		id: seed.id,
		name: seed.name,
		parentId: seed.parentId ?? null,
		role: seed.role ?? null,
		sortOrder: seed.sortOrder ?? 10,
		totalEmails: 0,
		unreadEmails: 0,
	};
}

/** Count each mailbox's messages and unread messages. */
export function withCounts(
	mailboxes: Iterable<Mailbox>,
	messages: Iterable<MailMessage>,
): Mailbox[] {
	const totals = new Map<string, { total: number; unread: number }>();
	for (const message of messages) {
		for (const id of message.mailboxIds) {
			const entry = totals.get(id) ?? { total: 0, unread: 0 };
			entry.total++;
			if (!message.keywords[SEEN]) entry.unread++;
			totals.set(id, entry);
		}
	}
	return [...mailboxes].map((mailbox) => ({
		...mailbox,
		totalEmails: totals.get(mailbox.id)?.total ?? 0,
		unreadEmails: totals.get(mailbox.id)?.unread ?? 0,
	}));
}

/**
 * True when a message carries a file to list: a part that is not an image its HTML shows in place,
 * as the reading pane lists them (`hasListedFile`).
 */
const hasFile = (attachments: readonly MailAttachment[], html: string | undefined): boolean =>
	hasListedFile(attachments, html ? [html] : []);

function attachmentsOf(
	id: string,
	attachments: readonly OutgoingAttachment[],
	blobs: BlobStore,
): MailAttachment[] {
	return attachments.map((attachment, index) => {
		const blobId = `${id}-part-${index + 2}`;
		blobs.set(blobId, { bytes: attachment.bytes, type: attachment.type });
		return {
			partId: String(index + 2),
			blobId,
			name: attachment.name,
			type: attachment.type.toLowerCase(),
			size: attachment.bytes.length,
			disposition: attachment.inline ? 'inline' : 'attachment',
			cid: attachment.cid ?? null,
		};
	});
}

const preview = (message: { text?: string | null; html?: string | null }): string =>
	previewText(bodyText(message));

/** A stored message from a seed. */
export function messageFromSeed(seed: SeedMessage, id: string, blobs: BlobStore): MailMessage {
	const attachments = attachmentsOf(id, seed.attachments ?? [], blobs);
	const keywords = [
		...(seed.unread ? [] : [SEEN]),
		...(seed.flagged ? [FLAGGED] : []),
		...(seed.keywords ?? []),
	];
	return {
		id,
		threadId: id,
		blobId: `${id}-raw`,
		mailboxIds: [seed.mailboxId],
		keywords: keywordsOf(keywords),
		receivedAt: seed.receivedAt,
		sentAt: seed.sentAt ?? seed.receivedAt,
		size:
			(seed.text?.length ?? 0) +
			(seed.html?.length ?? 0) +
			attachments.reduce((n, a) => n + a.size, 0),
		messageId: [seed.messageId ?? `${id}@memory.invalid`],
		inReplyTo: [...(seed.inReplyTo ?? [])],
		references: [...(seed.references ?? [])],
		from: [seed.from],
		to: [...(seed.to ?? [])],
		cc: [...(seed.cc ?? [])],
		bcc: [...(seed.bcc ?? [])],
		replyTo: [...(seed.replyTo ?? [])],
		subject: seed.subject,
		preview: preview(seed),
		hasAttachment: hasFile(attachments, seed.html),
		text: seed.text ?? null,
		html: seed.html ?? null,
		attachments,
	};
}

/**
 * A stored message from a draft (`$draft` in Drafts) or a sent copy (in Sent), its parts kept as
 * the draft has them: inline with their Content-ID, or attached, and its plain text as written
 * (`plainText`: the HTML's for a draft that has only HTML). `from` is the address the transport
 * writes it from; without one it has no From.
 */
export function messageFromDraft(
	draft: Draft,
	id: string,
	options: {
		mailboxId: string;
		sent: boolean;
		now: number;
		from: MailAddress | undefined;
		blobs: BlobStore;
	},
): MailMessage {
	const attachments: MailAttachment[] = draft.attachments.map((attachment, index) => ({
		partId: String(index + 2),
		blobId: attachment.blobId,
		name: attachment.name,
		type: attachment.type,
		size: options.blobs.get(attachment.blobId)?.bytes.length ?? attachment.size,
		disposition: attachment.inline ? 'inline' : 'attachment',
		cid: attachment.cid ?? null,
	}));
	const text = plainText(draft);
	return {
		id,
		threadId: id,
		blobId: `${id}-raw`,
		mailboxIds: [options.mailboxId],
		keywords: keywordsOf(options.sent ? [SEEN] : [SEEN, DRAFT]),
		receivedAt: options.now,
		sentAt: options.now,
		size: text.length + (draft.html?.length ?? 0) + attachments.reduce((n, a) => n + a.size, 0),
		messageId: [`${id}@memory.invalid`],
		inReplyTo: [...(draft.inReplyTo ?? [])],
		references: [...(draft.references ?? [])],
		from: options.from ? [options.from] : [],
		to: [...draft.to],
		cc: [...draft.cc],
		bcc: [...draft.bcc],
		replyTo: [],
		subject: draft.subject,
		preview: preview({ ...draft, text }),
		hasAttachment: hasFile(attachments, draft.html),
		text,
		html: draft.html ?? null,
		attachments,
	};
}

/** A stored message from raw RFC 5322 bytes (an imported `.eml`), its parts kept as blobs. */
export function messageFromRaw(
	bytes: Uint8Array,
	id: string,
	options: { mailboxId: string; now: number; blobs: BlobStore },
): MailMessage {
	const parsed = readEmail(bytes);
	const blobIdOf = (partId: string): string => `${id}-part-${partId}`;
	for (const attachment of parsed.attachments)
		options.blobs.set(blobIdOf(attachment.partId), {
			bytes: attachment.bytes,
			type: attachment.type,
		});
	options.blobs.set(`${id}-raw`, { bytes, type: 'message/rfc822' });
	return toMailMessage(
		parsed,
		{
			id,
			threadId: id,
			blobId: `${id}-raw`,
			mailboxIds: [options.mailboxId],
			keywords: {},
			receivedAt: options.now,
			size: bytes.length,
		},
		blobIdOf,
	);
}

/**
 * A stored message as raw RFC 5322 bytes (its `.eml`), written from what is kept of it; one with no
 * From is written from `account`, one with only HTML with the HTML's text as its plain part
 * (`plainText`). A draft keeps its Bcc, as a client's own copy does.
 */
export function messageBytes(target: MailMessage, blobs: BlobStore, account: string): Uint8Array {
	return writeEmail(
		{
			from: target.from[0] ?? { name: '', email: account },
			to: target.to,
			cc: target.cc,
			bcc: target.bcc,
			replyTo: target.replyTo,
			subject: target.subject,
			text: plainText({ text: target.text ?? '', html: target.html ?? undefined }),
			...(target.html ? { html: target.html } : {}),
			attachments: target.attachments.map((attachment) => ({
				name: attachment.name,
				type: attachment.type,
				bytes: blobs.get(attachment.blobId)?.bytes ?? new Uint8Array(),
				...(attachment.cid ? { cid: attachment.cid } : {}),
				inline: attachment.disposition === 'inline',
			})),
			...(target.messageId[0] ? { messageId: target.messageId[0] } : {}),
			inReplyTo: target.inReplyTo,
			references: target.references,
			date: target.sentAt ?? target.receivedAt,
		},
		{ includeBcc: target.keywords[DRAFT] === true },
	);
}
