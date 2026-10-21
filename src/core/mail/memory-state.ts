// What a memory transport holds: its folders, messages and files, the change feed its `watch`
// listeners hear, and the rules its calls share (ids, folder patches, the folder of a role). Split
// from `memory-transport.ts`, which makes each call of the transport contract on it. New code.
import { DEFAULT_MAILBOXES, mailboxOf, messageFromSeed, type BlobStore } from './memory-messages';
import type { MemoryTransportOptions } from './memory-transport';
import type { Identity, MailAccount, Mailbox, MailMessage } from './model';
import { MailTransportError, type EmailPatch, type MailChange } from './transport';

const DEFAULT_ACCOUNT: MailAccount = { id: 'local', name: 'you@example.com' };
const DEFAULT_IDENTITY: Identity = {
	id: 'me',
	name: 'You',
	email: 'you@example.com',
	replyTo: [],
	bcc: [],
	textSignature: '',
	htmlSignature: '',
};

export interface MemoryState {
	readonly account: MailAccount;
	readonly identities: readonly Identity[];
	readonly blobs: BlobStore;
	readonly mailboxes: Map<string, Mailbox>;
	readonly messages: Map<string, MailMessage>;
	readonly listeners: Set<(change: MailChange) => void>;
	/** The addresses (lower case) a sent message is also delivered to the Inbox for. */
	readonly own: ReadonlySet<string>;
	readonly now: () => number;
	/** Set once the transport is closed: every call fails from then on. */
	closed: boolean;
	/** The next id in the transport's numbering that is not taken: seeds may use the same names. */
	nextId(prefix: string, taken: { has(id: string): boolean }): string;
	/** Before each call: it fails once the transport is closed, and waits the artificial delay. */
	settle(): Promise<void>;
	/** Tell the `watch` listeners of `change`, once the call that made it has returned. */
	emit(change: MailChange): void;
	/** Tell them of changed messages, and with them of the folders, whose counts change too. */
	emailsChanged(created: string[], updated: string[], destroyed: string[]): void;
	/** The message `id`; `notFound` when there is none. */
	message(id: string): MailMessage;
	/** `target` as `patch` changes it; throws for a folder that is missing or one left with none. */
	patched(target: MailMessage, patch: EmailPatch): MailMessage;
	/** The folder with `role`; `notFound` when there is none. */
	byRole(role: Mailbox['role']): Mailbox;
}

export function createMemoryState(options: MemoryTransportOptions): MemoryState {
	const identities = options.identities?.length ? options.identities : [DEFAULT_IDENTITY];
	let sequence = 0;
	const state: MemoryState = {
		account: options.account ?? DEFAULT_ACCOUNT,
		identities,
		blobs: new Map(),
		mailboxes: new Map(),
		messages: new Map(),
		listeners: new Set(),
		own: new Set(
			(options.loopback ?? identities.map((identity) => identity.email)).map((a) =>
				a.toLowerCase(),
			),
		),
		now: options.now ?? Date.now,
		closed: false,
		nextId(prefix, taken) {
			let id: string;
			do {
				id = `${prefix}${(++sequence).toString(36)}`;
			} while (taken.has(id));
			return id;
		},
		async settle() {
			if (state.closed) throw new MailTransportError('network', 'The transport is closed.');
			if (options.latencyMs) await new Promise((resolve) => setTimeout(resolve, options.latencyMs));
		},
		emit(change) {
			queueMicrotask(() => {
				for (const listener of [...state.listeners]) listener(change);
			});
		},
		emailsChanged(created, updated, destroyed) {
			state.emit({ type: 'emails', created, updated, destroyed });
			state.emit({ type: 'mailboxes' });
		},
		message(id) {
			const found = state.messages.get(id);
			if (!found) throw new MailTransportError('notFound', `No message ${id}.`);
			return found;
		},
		patched(target, patch) {
			const keywords: Record<string, true> = { ...target.keywords };
			for (const [keyword, on] of Object.entries(patch.keywords ?? {}))
				if (on) keywords[keyword] = true;
				else delete keywords[keyword];
			const boxes = new Set(target.mailboxIds);
			for (const [box, on] of Object.entries(patch.mailboxIds ?? {})) {
				if (on && !state.mailboxes.has(box))
					throw new MailTransportError('notFound', `No mailbox ${box}.`);
				if (on) boxes.add(box);
				else boxes.delete(box);
			}
			if (!boxes.size) throw new MailTransportError('invalid', 'A message must stay in a mailbox.');
			return { ...target, keywords, mailboxIds: [...boxes] };
		},
		byRole(role) {
			for (const mailbox of state.mailboxes.values()) if (mailbox.role === role) return mailbox;
			throw new MailTransportError('notFound', `No ${role} mailbox.`);
		},
	};
	for (const seed of options.mailboxes ?? DEFAULT_MAILBOXES)
		state.mailboxes.set(seed.id, mailboxOf(seed));
	const seeds = options.messages ?? [];
	const named = new Set(seeds.flatMap((seed) => (seed.id === undefined ? [] : [seed.id])));
	for (const seed of seeds) {
		const id = seed.id ?? state.nextId('m', named);
		state.messages.set(id, messageFromSeed(seed, id, state.blobs));
	}
	return state;
}
