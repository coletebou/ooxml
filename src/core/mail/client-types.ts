// The shape of the mail client: one immutable `MailState` snapshot and plain actions, the surface
// every binding's raw hook wraps (React `useMail`, ...). Anything a screen shows is in the state;
// anything a button does is an action. New code.
import type { CalendarEvent } from '../calendar/model';
import type { ComposeMode, DraftHtml, QuoteFormat } from './compose';
import type { Contact, ContactStore } from './contacts';
import type { CalendarStore } from './calendar-store';
import type {
	Draft,
	EmailSummary,
	Identity,
	MailAccount,
	MailAddress,
	MailAttachment,
	Mailbox,
	MailMessage,
} from './model';
import type { MailErrorCode, MailSession, MailTransport } from './transport';

export type MailStatus = 'connecting' | 'ready' | 'error' | 'closed';

/** A mailbox as the folder pane lists it: special-use folders first, children under parents. */
export interface MailboxView extends Mailbox {
	depth: number;
}

/** One row of the message list: a conversation (or a single message when threading is off). */
export interface ConversationView {
	id: string;
	/** Every message, in reading order. */
	emailIds: readonly string[];
	/** The newest message, the one a reply answers: reading order is the thread's, not by date. */
	latestId: string;
	/** The first message's subject. */
	subject: string;
	/** Senders, in the order they first wrote, each once. */
	participants: readonly MailAddress[];
	/** Who the newest message went to (To, then Cc): what Sent and Drafts show. */
	recipients: readonly MailAddress[];
	/** The newest message's preview. */
	preview: string;
	date: number;
	count: number;
	unread: number;
	flagged: boolean;
	hasAttachment: boolean;
	draft: boolean;
}

export interface OpenMessageView {
	summary: EmailSummary;
	depth: number;
	/** The full message once loaded. */
	message: MailMessage | null;
	error: MailErrorCode | null;
}

/** The conversation in the reading pane. */
export interface OpenConversationView {
	id: string;
	subject: string;
	messages: readonly OpenMessageView[];
}

export type ComposeStatus = 'editing' | 'saving' | 'saved' | 'sending' | 'error';

export interface ComposeState {
	/** Changes each time a compose window opens, so a UI knows to load the new draft's body. */
	session: number;
	mode: ComposeMode;
	draft: Draft;
	status: ComposeStatus;
	/** When the draft was last saved on the server. */
	savedAt: number | null;
	error: MailErrorCode | null;
	/** Files still uploading. */
	uploading: number;
}

export type SearchScope = 'mailbox' | 'all';

export interface MailState {
	status: MailStatus;
	error: MailErrorCode | null;
	account: MailAccount | null;
	identities: readonly Identity[];
	canSend: boolean;
	mailboxes: readonly MailboxView[];
	/** The open folder (kept while searching, so a search can be scoped to it). */
	mailboxId: string | null;
	threaded: boolean;
	/** The search box text; empty when not searching. */
	query: string;
	searchScope: SearchScope;
	/** The list is loading (a folder switch, a search, a refresh). */
	loading: boolean;
	conversations: readonly ConversationView[];
	/** Messages the folder or search holds on the server; may exceed what is loaded. */
	total: number;
	/** Messages loaded into the list. */
	loaded: number;
	selection: readonly string[];
	/** The list cursor (keyboard focus), a conversation id. */
	focusedId: string | null;
	open: OpenConversationView | null;
	compose: ComposeState | null;
	contacts: readonly Contact[];
	events: readonly CalendarEvent[];
}

/** What just happened, for a toast; `undo` reverses it while the toast is shown. */
export type MailNotice =
	| {
			kind: 'done';
			action:
				| 'sent'
				| 'saved'
				| 'moved'
				| 'archived'
				| 'junk'
				| 'deleted'
				| 'discarded'
				| 'imported'
				| 'contactsImported'
				| 'eventsImported'
				| 'undone';
			count: number;
			/** Mailbox name for `moved`. */
			target?: string;
			undo?: () => Promise<void>;
	  }
	| { kind: 'error'; action: MailAction; code: MailErrorCode }
	/** Cards a vCard import could not read. */
	| { kind: 'warning'; action: 'contactsImported'; skipped: number }
	/** What an iCalendar import could not represent, one line per problem. */
	| { kind: 'warning'; action: 'eventsImported'; unsupported: readonly string[] }
	/**
	 * The compose window stays open, nothing opens in its place and its message is not sent while
	 * files are still uploading into its draft (`compose`, `editDraft`, `closeCompose` and `send`
	 * resolve false).
	 */
	| { kind: 'warning'; action: 'upload'; uploading: number }
	/**
	 * Files a person picked or dropped that the browser could not read (deleted, moved or changed
	 * since), by name: they were left out, the others attached or imported. The app's own; the
	 * client never gives it.
	 */
	| { kind: 'warning'; action: 'readFiles'; names: readonly string[] };

export type MailAction =
	| 'connect'
	| 'load'
	| 'open'
	| 'update'
	| 'move'
	| 'delete'
	| 'mailbox'
	| 'save'
	| 'send'
	| 'upload'
	| 'download'
	| 'import'
	| 'contacts'
	| 'calendar';

export interface FileInput {
	name: string;
	type: string;
	bytes: Uint8Array;
}

export interface MailClientOptions {
	transport: MailTransport;
	/**
	 * Close the transport when the client is destroyed. Default true; false for a transport the
	 * host owns and may hand to another client: destroying the client then only stops it using the
	 * transport, which stays open until the host closes it.
	 */
	closeTransport?: boolean;
	contacts?: ContactStore;
	calendar?: CalendarStore;
	/**
	 * The address book and the calendar of the account, opened once, when the client first
	 * connects (the session says which account it is and who signed in), for stores kept per
	 * account. `contacts` and `calendar`, when given, are used instead.
	 */
	openStores?: (session: MailSession) => { contacts?: ContactStore; calendar?: CalendarStore };
	/** The words around quoted replies and forwards; English when omitted. */
	quoteFormat?: QuoteFormat;
	/**
	 * The HTML a reply's or forward's quote, or a saved draft opened again, holds of a message. A UI
	 * passes one that cleans each part of the body on its own (`ooxml-ui/mail`'s `createMail` does);
	 * without it, the HTML as sent (`DraftHtml`).
	 */
	draftHtml?: DraftHtml;
	now?: () => number;
	/** Quiet time before a draft is saved automatically. Default 2 seconds. */
	draftSaveMs?: number;
	/** Newest messages a folder or search loads at first; `loadMore` raises it. Default 2000. */
	listLimit?: number;
	/** Open conversations are marked read. Default true. */
	markReadOnOpen?: boolean;
	/** Thread the list into conversations. Default true. */
	threaded?: boolean;
	setTimeout?: (callback: () => void, ms: number) => unknown;
	clearTimeout?: (handle: unknown) => void;
}

/** Conversation ids; omitted means the selection, or else the open conversation. */
export type Targets = readonly string[] | undefined;

export interface MailClient {
	getState(): MailState;
	/** Called after every state change (coalesced per tick); returns the unsubscribe function. */
	subscribe(listener: () => void): () => void;
	onNotice(listener: (notice: MailNotice) => void): () => void;
	refresh(): Promise<void>;
	selectMailbox(id: string): Promise<void>;
	setThreaded(threaded: boolean): void;
	search(query: string): Promise<void>;
	setSearchScope(scope: SearchScope): Promise<void>;
	loadMore(): Promise<void>;
	select(ids: readonly string[]): void;
	toggleSelected(id: string): void;
	/** Extend the selection from the cursor to `id` (shift-click). */
	selectRange(id: string): void;
	selectAll(): void;
	clearSelection(): void;
	focus(id: string | null): void;
	/** Move the cursor one row; returns the new cursor. */
	focusNext(step?: 1 | -1): string | null;
	open(id: string): Promise<void>;
	close(): void;
	markRead(read: boolean, ids?: Targets): Promise<void>;
	toggleRead(ids?: Targets): Promise<void>;
	setFlagged(flagged: boolean, ids?: Targets): Promise<void>;
	toggleFlagged(ids?: Targets): Promise<void>;
	moveTo(mailboxId: string, ids?: Targets): Promise<void>;
	archive(ids?: Targets): Promise<void>;
	markJunk(ids?: Targets): Promise<void>;
	/**
	 * To Trash. Deleted in Trash, a message only there is deleted for good; one also filed in another
	 * folder leaves Trash and stays in that folder.
	 */
	remove(ids?: Targets): Promise<void>;
	createMailbox(name: string, parentId?: string | null): Promise<void>;
	renameMailbox(id: string, name: string): Promise<void>;
	deleteMailbox(id: string): Promise<void>;
	/**
	 * Open the compose window on a new message, or an answer to or forward of `emailId`. False when
	 * it did not open: the message could not be read, or the open draft could not be saved (that
	 * window stays open, its status saying why), or a file is still uploading into it (a notice
	 * says so).
	 */
	compose(mode: ComposeMode, emailId?: string): Promise<boolean>;
	/**
	 * Reopen a saved draft in the compose window; false as for `compose`. Saved, the window replaces
	 * the message it opened, so only a draft opens: one marked `$draft` or filed in Drafts, as the
	 * list knows it now (in Drafts only where the account has a Sent folder: without one, what it
	 * sent stays in Drafts). Any other message is refused with an `invalid` error notice, the open
	 * window left as it is.
	 */
	editDraft(emailId: string): Promise<boolean>;
	/**
	 * Change the open draft. A new `text` without `html` leaves out an HTML no patch of this window
	 * gave (an answer's or a forward's quote, a reopened draft's), which would still say what the
	 * text said before: the message goes as its text alone (`patchDraft`).
	 */
	updateDraft(patch: Partial<Omit<Draft, 'id' | 'attachments'>>): void;
	attach(files: readonly FileInput[]): Promise<void>;
	detach(blobId: string): void;
	saveDraft(): Promise<void>;
	/**
	 * True when the message was handed to the server. False, the window left as it is, while a file
	 * is still uploading (a notice says so): sent then, the message would go without it.
	 */
	send(): Promise<boolean>;
	discardDraft(): Promise<void>;
	/**
	 * Close the compose window once the server holds its last edit, saving a draft that has anything
	 * in it. A draft that cannot be saved keeps the window open, its status saying why, and the
	 * result is false; so does a draft whose attachments are still uploading, with a notice.
	 */
	closeCompose(): Promise<boolean>;
	/** The bytes of an attachment. A failure is a `download` error notice, and the result rejects. */
	download(attachment: MailAttachment): Promise<Uint8Array>;
	/** A message as an `.eml` file; a failure is told as a download's is. */
	exportEml(emailId: string): Promise<FileInput>;
	importEml(files: readonly FileInput[], mailboxId?: string): Promise<void>;
	saveContact(contact: Contact): Promise<void>;
	deleteContact(id: string): Promise<void>;
	importVCards(text: string): Promise<number>;
	exportVCards(ids?: readonly string[]): string;
	saveEvent(event: CalendarEvent): Promise<void>;
	deleteEvent(id: string): Promise<void>;
	importIcs(text: string, zone?: string): Promise<number>;
	exportIcs(ids?: readonly string[]): string;
	/**
	 * Stop: no more changes from the transport, no more state or notices (answers still on their
	 * way are dropped), and the transport closed unless `closeTransport` is false.
	 */
	destroy(): void;
}
