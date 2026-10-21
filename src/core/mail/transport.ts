// The seam between the mail client and a server, pluggable the way Teams' signaling is: the client
// only ever calls these methods, so the memory transport (demos, tests) and the JMAP client
// (RFC 8620, RFC 8621) are interchangeable, and a transport for a provider's own API or an IMAP
// bridge can be added later without touching the client or the UI. New code.
import type {
	Draft,
	EmailSummary,
	Identity,
	MailAccount,
	Mailbox,
	MailboxRole,
	MailMessage,
} from './model';

export interface MailSession {
	account: MailAccount;
	identities: readonly Identity[];
	/** False when the server offers no submission (the account is read-only for sending). */
	canSend: boolean;
}

/**
 * A message search, every field optional and all of them combined with AND. Text fields match
 * case-insensitively; `text` searches subject, addresses and body at once (JMAP `text`).
 */
export interface MailQuery {
	mailboxId?: string;
	text?: string;
	from?: string;
	to?: string;
	subject?: string;
	body?: string;
	hasAttachment?: boolean;
	unread?: boolean;
	flagged?: boolean;
	/** Received strictly before / at or after this time (UTC milliseconds). */
	before?: number;
	after?: number;
}

export interface MailQueryPage {
	position?: number;
	limit?: number;
}

/** Matching ids, newest first. `total` counts every match, not just this page. */
export interface MailQueryResult {
	ids: readonly string[];
	total: number;
	position: number;
}

/** Keywords and mailboxes to add (`true`) or remove (`false`); the rest stay as they are. */
export interface EmailPatch {
	keywords?: Readonly<Record<string, boolean>>;
	mailboxIds?: Readonly<Record<string, boolean>>;
}

/** What changed on the server since the transport last looked. */
export type MailChange =
	| { type: 'mailboxes' }
	| {
			type: 'emails';
			created: readonly string[];
			updated: readonly string[];
			destroyed: readonly string[];
	  }
	/** The transport could not work out the difference: reload everything. */
	| { type: 'reset' };

export interface UploadedBlob {
	blobId: string;
	type: string;
	size: number;
}

export interface NewMailbox {
	name: string;
	parentId?: string | null;
	role?: MailboxRole | null;
}

export interface MessageReadOptions {
	/**
	 * Every body in full, to quote in an answer or edit as a draft; `tooLarge` when the server will
	 * not send it whole. Without it a long body may come cut short for display, `truncated` set.
	 */
	whole?: boolean;
}

export interface MailTransport {
	/** `memory`, `jmap`, ...: for diagnostics, never for branching in the UI. */
	readonly kind: string;
	connect(signal?: AbortSignal): Promise<MailSession>;
	mailboxes(): Promise<Mailbox[]>;
	createMailbox(input: NewMailbox): Promise<Mailbox>;
	renameMailbox(id: string, name: string): Promise<void>;
	/** Removes an empty folder the person made; special-use mailboxes are refused. */
	destroyMailbox(id: string): Promise<void>;
	query(query: MailQuery, page?: MailQueryPage): Promise<MailQueryResult>;
	/** Summaries in the order of `ids`; unknown ids are left out. */
	summaries(ids: readonly string[]): Promise<EmailSummary[]>;
	message(id: string, options?: MessageReadOptions): Promise<MailMessage>;
	update(patches: Readonly<Record<string, EmailPatch>>): Promise<void>;
	/** Deletes for good (the client moves to Trash first and only destroys from there). */
	destroy(ids: readonly string[]): Promise<void>;
	/** Saves `draft` in Drafts, replacing `draft.id` when set; returns the saved message's id. */
	saveDraft(draft: Draft): Promise<{ id: string }>;
	/**
	 * Sends `draft`, files it in Sent and removes the saved draft; returns the sent message's id.
	 * Fails with `uncertain`, not as not sent, when the server did not say whether it went out; the
	 * same draft sent again first asks whether that send went out.
	 */
	send(draft: Draft): Promise<{ id: string }>;
	upload(bytes: Uint8Array, type: string): Promise<UploadedBlob>;
	download(blobId: string, options: { type: string; name: string }): Promise<Uint8Array>;
	/** Adds a raw RFC 5322 message (an `.eml` file) to a mailbox. */
	importMessage(bytes: Uint8Array, mailboxId: string): Promise<{ id: string }>;
	/** Push: calls `listener` for each change until the returned function is called. */
	watch(listener: (change: MailChange) => void): () => void;
	close(): void;
}

/** Why a transport call failed, so the UI can word it in the person's language. */
export type MailErrorCode =
	| 'unauthorized'
	| 'forbidden'
	| 'network'
	| 'notFound'
	| 'invalid'
	| 'overQuota'
	| 'tooLarge'
	| 'rateLimited'
	| 'unsupported'
	| 'server'
	/** A send the server did not confirm, which may have gone out: not a failure to send. */
	| 'uncertain';

export class MailTransportError extends Error {
	readonly code: MailErrorCode;
	constructor(code: MailErrorCode, message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'MailTransportError';
		this.code = code;
	}
}

export function isMailTransportError(error: unknown): error is MailTransportError {
	return error instanceof MailTransportError;
}
