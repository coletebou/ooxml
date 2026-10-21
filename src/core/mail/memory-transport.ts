// `createMemoryTransport`: a whole mail server in memory, for demos, tests and local-first
// prototypes. Same contract as the JMAP client, so the UI cannot tell them apart; changes are pushed
// to `watch` listeners like a server's push. Nothing leaves the page. What it holds is in
// `memory-state.ts`, saving and sending in `memory-outgoing.ts`. New code.
import {
	mailboxOf,
	messageBytes,
	messageFromRaw,
	messageFromSeed,
	withCounts,
	type SeedMailbox,
	type SeedMessage,
} from './memory-messages';
import { createOutgoing } from './memory-outgoing';
import { createMemoryState } from './memory-state';
import { SEEN, type Identity, type MailAccount } from './model';
import { matchesQuery } from './search';
import {
	MailTransportError,
	PartialUpdateError,
	type EmailPatch,
	type MailTransport,
} from './transport';

export interface MemoryTransportOptions {
	account?: MailAccount;
	identities?: readonly Identity[];
	/** Folders; the standard six by default. */
	mailboxes?: readonly SeedMailbox[];
	messages?: readonly SeedMessage[];
	now?: () => number;
	/** Artificial delay per call, to see loading states in a demo. */
	latencyMs?: number;
	/**
	 * Deliver a sent message to the Inbox too when it is addressed to one of these addresses (the
	 * person's own by default), so a demo can mail itself.
	 */
	loopback?: readonly string[];
}

export interface MemoryTransport extends MailTransport {
	/** Put a message in a mailbox as if it had just arrived; returns its id. */
	deliver(message: SeedMessage): string;
}

export function createMemoryTransport(options: MemoryTransportOptions = {}): MemoryTransport {
	const state = createMemoryState(options);
	const { blobs, mailboxes, messages, listeners } = state;
	const transport: MemoryTransport = {
		kind: 'memory',
		async connect() {
			await state.settle();
			return { account: state.account, identities: state.identities, canSend: true };
		},
		async mailboxes() {
			await state.settle();
			return withCounts(mailboxes.values(), messages.values());
		},
		async createMailbox(input) {
			await state.settle();
			const mailbox = mailboxOf({
				id: state.nextId('f', mailboxes),
				name: input.name,
				parentId: input.parentId ?? null,
				role: input.role ?? null,
			});
			mailboxes.set(mailbox.id, mailbox);
			state.emit({ type: 'mailboxes' });
			return mailbox;
		},
		async renameMailbox(id, name) {
			await state.settle();
			const mailbox = mailboxes.get(id);
			if (!mailbox) throw new MailTransportError('notFound', `No mailbox ${id}.`);
			mailboxes.set(id, { ...mailbox, name });
			state.emit({ type: 'mailboxes' });
		},
		async destroyMailbox(id) {
			await state.settle();
			const mailbox = mailboxes.get(id);
			if (!mailbox) throw new MailTransportError('notFound', `No mailbox ${id}.`);
			if (mailbox.role)
				throw new MailTransportError('forbidden', 'Special folders cannot be deleted.');
			// Its folders would be left with a parent that is gone (JMAP's `mailboxHasChild`).
			if ([...mailboxes.values()].some((other) => other.parentId === id))
				throw new MailTransportError('invalid', 'The folder has folders inside it.');
			if ([...messages.values()].some((m) => m.mailboxIds.includes(id)))
				throw new MailTransportError('invalid', 'The folder is not empty.');
			mailboxes.delete(id);
			state.emit({ type: 'mailboxes' });
		},
		async query(query, page = {}) {
			await state.settle();
			const matching = [...messages.values()]
				.filter((m) => matchesQuery(m, query))
				.sort((a, b) => b.receivedAt - a.receivedAt || a.id.localeCompare(b.id));
			const position = Math.max(0, page.position ?? 0);
			const end = page.limit === undefined ? undefined : position + page.limit;
			return {
				ids: matching.slice(position, end).map((m) => m.id),
				total: matching.length,
				position,
			};
		},
		async summaries(ids) {
			await state.settle();
			return ids.flatMap((id) => {
				const found = messages.get(id);
				if (!found) return [];
				// Every field only a whole message has (`MailMessage` beyond `EmailSummary`) stays out.
				const {
					text: _text,
					html: _html,
					htmlParts: _htmlParts,
					attachments: _attachments,
					truncated: _truncated,
					...summary
				} = found;
				return [summary];
			});
		},
		async message(id) {
			await state.settle();
			return state.message(id);
		},
		async update(patches) {
			await state.settle();
			const updated: string[] = [];
			let failure: unknown;
			// Each message is changed on its own, as a JMAP server does: one refused, the rest still are.
			for (const [id, patch] of Object.entries(patches) as [string, EmailPatch][]) {
				try {
					messages.set(id, state.patched(state.message(id), patch));
					updated.push(id);
				} catch (error) {
					failure ??= error;
				}
			}
			if (updated.length) state.emailsChanged([], updated, []);
			if (failure !== undefined)
				throw updated.length ? new PartialUpdateError(updated, failure) : failure;
		},
		async destroy(ids) {
			await state.settle();
			const destroyed = ids.filter((id) => messages.delete(id));
			if (destroyed.length) state.emailsChanged([], [], destroyed);
		},
		...createOutgoing(state),
		async upload(bytes, type) {
			await state.settle();
			const blobId = state.nextId('b', blobs);
			blobs.set(blobId, { bytes: bytes.slice(), type });
			return { blobId, type, size: bytes.length };
		},
		async download(blobId) {
			await state.settle();
			const blob = blobs.get(blobId);
			if (blob) return blob.bytes.slice();
			const owner = [...messages.values()].find((m) => m.blobId === blobId);
			if (!owner) throw new MailTransportError('notFound', `No blob ${blobId}.`);
			return messageBytes(owner, blobs, state.account.name);
		},
		async importMessage(bytes, mailboxId) {
			await state.settle();
			if (!mailboxes.has(mailboxId))
				throw new MailTransportError('notFound', `No mailbox ${mailboxId}.`);
			const id = state.nextId('i', messages);
			const imported = messageFromRaw(bytes, id, { mailboxId, now: state.now(), blobs });
			messages.set(id, { ...imported, keywords: { [SEEN]: true } });
			state.emailsChanged([id], [], []);
			return { id };
		},
		watch(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		close() {
			state.closed = true;
			listeners.clear();
		},
		deliver(seed) {
			const id = seed.id ?? state.nextId('m', messages);
			messages.set(id, messageFromSeed(seed, id, blobs));
			state.emailsChanged([id], [], []);
			return id;
		},
	};
	return transport;
}
