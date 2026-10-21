// The mail client's internal state holder, shared by the modules that implement its actions
// (`client.ts`, `client-mutations.ts`, `client-compose.ts`, `client-files.ts`, `client-people.ts`).
// It owns the caches (summaries, loaded bodies), rebuilds the derived state when they change and
// coalesces notifications per tick, like the Teams client. Not exported from the area. New code.
import { Emitter } from '../collab/emitter';
import type { MailAction, MailClientOptions, MailNotice, MailState, Targets } from './client-types';
import { conversationView, mailboxViews, openConversationView } from './client-views';
import type { EmailSummary, Mailbox, MailboxRole, MailMessage } from './model';
import { threadConversations, type Conversation } from './threading';
import { isMailTransportError, type MailErrorCode, type MailTransport } from './transport';

const BODY_CACHE = 200;

export const INITIAL_STATE: MailState = {
	status: 'connecting',
	error: null,
	account: null,
	identities: [],
	canSend: false,
	mailboxes: [],
	mailboxId: null,
	threaded: true,
	query: '',
	searchScope: 'mailbox',
	loading: false,
	conversations: [],
	total: 0,
	loaded: 0,
	selection: [],
	focusedId: null,
	open: null,
	compose: null,
	contacts: [],
	events: [],
};

export const errorCode = (error: unknown): MailErrorCode =>
	isMailTransportError(error) ? error.code : 'server';

export class ClientCore {
	readonly transport: MailTransport;
	readonly options: MailClientOptions;
	readonly notices = new Emitter<{ notice: MailNotice }>();
	/** Summaries of every message the list or the reading pane has seen, by id. */
	readonly emails = new Map<string, EmailSummary>();
	/** Full messages, most recently used last. */
	readonly bodies = new Map<string, MailMessage>();
	readonly bodyErrors = new Map<string, MailErrorCode>();
	mailboxes: Mailbox[] = [];
	/** The ids the current folder or search returned, newest first. */
	listIds: string[] = [];
	conversations: Conversation[] = [];
	conversationsById = new Map<string, Conversation>();
	openId: string | null = null;
	destroyed = false;
	private current: MailState;
	private readonly listeners = new Set<() => void>();
	private scheduled = false;

	constructor(options: MailClientOptions) {
		this.transport = options.transport;
		this.options = options;
		this.current = { ...INITIAL_STATE, threaded: options.threaded ?? true };
	}

	get state(): MailState {
		return this.current;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Replace part of the state and notify once per tick. */
	patch(partial: Partial<MailState>): void {
		if (this.destroyed) return;
		this.current = { ...this.current, ...partial };
		if (this.scheduled) return;
		this.scheduled = true;
		queueMicrotask(() => {
			this.scheduled = false;
			for (const listener of [...this.listeners]) listener();
		});
	}

	notice(notice: MailNotice): void {
		this.notices.emit('notice', notice);
	}

	fail(action: MailAction, error: unknown): void {
		this.notice({ kind: 'error', action, code: errorCode(error) });
	}

	now(): number {
		return (this.options.now ?? Date.now)();
	}

	/** A timer through the injected `setTimeout` (tests), else the platform's. */
	later(callback: () => void, ms: number): unknown {
		return this.options.setTimeout
			? this.options.setTimeout(callback, ms)
			: setTimeout(callback, ms);
	}

	cancel(handle: unknown): void {
		if (handle === undefined) return;
		if (this.options.clearTimeout) this.options.clearTimeout(handle);
		else clearTimeout(handle as ReturnType<typeof setTimeout>);
	}

	mailboxByRole(role: MailboxRole): Mailbox | undefined {
		return this.mailboxes.find((mailbox) => mailbox.role === role);
	}

	/** The folder the list shows: the open one, or none while a search spans every folder. */
	listMailboxId(): string | null {
		const { query, searchScope, mailboxId } = this.state;
		return query && searchScope === 'all' ? null : mailboxId;
	}

	setMailboxes(mailboxes: Mailbox[]): void {
		this.mailboxes = mailboxes;
		this.patch({ mailboxes: mailboxViews(mailboxes) });
	}

	/** Keep a body, evicting the least recently used beyond the cache size. */
	keepBody(message: MailMessage): void {
		this.bodies.delete(message.id);
		this.bodies.set(message.id, message);
		this.bodyErrors.delete(message.id);
		while (this.bodies.size > BODY_CACHE) this.bodies.delete(this.bodies.keys().next().value!);
	}

	/** Re-thread the list and refresh every view derived from it. */
	rebuild(): void {
		const emails = this.listIds.flatMap((id) => {
			const email = this.emails.get(id);
			return email ? [email] : [];
		});
		this.conversations = threadConversations(emails, { byReferences: this.state.threaded });
		this.conversationsById = new Map(this.conversations.map((c) => [c.id, c]));
		const exists = (id: string): boolean => this.conversationsById.has(id);
		const open = this.openId ? this.conversationsById.get(this.openId) : undefined;
		if (!open) this.openId = null;
		this.patch({
			conversations: this.conversations.map(conversationView),
			loaded: emails.length,
			selection: this.state.selection.filter(exists),
			focusedId: this.state.focusedId && exists(this.state.focusedId) ? this.state.focusedId : null,
			open: open ? openConversationView(open, this.bodies, this.bodyErrors) : null,
		});
	}

	/** Email ids of conversations (or of messages, by their own id). */
	emailIdsOf(ids: Targets): string[] {
		const targets =
			ids ??
			(this.state.selection.length ? this.state.selection : this.openId ? [this.openId] : []);
		const out = new Set<string>();
		for (const id of targets) {
			const conversation = this.conversationsById.get(id);
			if (conversation) for (const entry of conversation.entries) out.add(entry.email.id);
			else if (this.emails.has(id)) out.add(id);
		}
		return [...out];
	}

	/** Apply `change` to cached summaries now; the returned function puts them back. */
	applyLocal(
		emailIds: readonly string[],
		change: (email: EmailSummary) => EmailSummary,
	): () => void {
		const before = new Map<string, EmailSummary>();
		for (const id of emailIds) {
			const email = this.emails.get(id);
			if (!email) continue;
			before.set(id, email);
			this.emails.set(id, change(email));
		}
		this.rebuild();
		return () => {
			for (const [id, email] of before) this.emails.set(id, email);
			this.rebuild();
		};
	}
}
