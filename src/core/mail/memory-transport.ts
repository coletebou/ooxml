// `createMemoryTransport`: a whole mail server in memory, for demos, tests and local-first
// prototypes. Same contract as the JMAP client, so the UI cannot tell them apart; changes are pushed
// to `watch` listeners like a server's push. Nothing leaves the page. New code.
import { draftRecipients } from './compose';
import { writeEmail } from './mime';
import {
	ANSWERED,
	DRAFT,
	FORWARDED,
	SEEN,
	isWildcardAddress,
	type Draft,
	type Identity,
	type MailAccount,
	type MailAddress,
	type Mailbox,
	type MailMessage,
} from './model';
import {
	DEFAULT_MAILBOXES,
	mailboxOf,
	messageFromDraft,
	messageFromRaw,
	messageFromSeed,
	withCounts,
	type BlobStore,
	type SeedMailbox,
	type SeedMessage,
} from './memory-messages';
import { matchesQuery } from './search';
import {
	MailTransportError,
	type EmailPatch,
	type MailChange,
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

export function createMemoryTransport(options: MemoryTransportOptions = {}): MemoryTransport {
	const now = options.now ?? Date.now;
	const account = options.account ?? DEFAULT_ACCOUNT;
	const identities = options.identities?.length ? options.identities : [DEFAULT_IDENTITY];
	const blobs: BlobStore = new Map();
	const mailboxes = new Map<string, Mailbox>();
	const messages = new Map<string, MailMessage>();
	const listeners = new Set<(change: MailChange) => void>();
	let sequence = 0;
	let closed = false;
	/** The next id in the transport's numbering that is not taken: seeds may use the same names. */
	const nextId = (prefix: string, taken: { has(id: string): boolean }): string => {
		let id: string;
		do {
			id = `${prefix}${(++sequence).toString(36)}`;
		} while (taken.has(id));
		return id;
	};
	for (const seed of options.mailboxes ?? DEFAULT_MAILBOXES)
		mailboxes.set(seed.id, mailboxOf(seed));
	const seeds = options.messages ?? [];
	const named = new Set(seeds.flatMap((seed) => (seed.id === undefined ? [] : [seed.id])));
	for (const seed of seeds) {
		const id = seed.id ?? nextId('m', named);
		messages.set(id, messageFromSeed(seed, id, blobs));
	}
	const own = new Set(
		(options.loopback ?? identities.map((identity) => identity.email)).map((a) => a.toLowerCase()),
	);

	const settle = async (): Promise<void> => {
		if (closed) throw new MailTransportError('network', 'The transport is closed.');
		if (options.latencyMs) await new Promise((resolve) => setTimeout(resolve, options.latencyMs));
	};
	const emit = (change: MailChange): void => {
		queueMicrotask(() => {
			for (const listener of [...listeners]) listener(change);
		});
	};
	const emailsChanged = (created: string[], updated: string[], destroyed: string[]): void => {
		emit({ type: 'emails', created, updated, destroyed });
		emit({ type: 'mailboxes' });
	};
	const message = (id: string): MailMessage => {
		const found = messages.get(id);
		if (!found) throw new MailTransportError('notFound', `No message ${id}.`);
		return found;
	};
	const byRole = (role: Mailbox['role']): Mailbox => {
		for (const mailbox of mailboxes.values()) if (mailbox.role === role) return mailbox;
		throw new MailTransportError('notFound', `No ${role} mailbox.`);
	};
	/**
	 * The address a draft is sent from: its own, else its identity's, else the first identity's. A
	 * `*@domain` wildcard is never one, as a server would never send from it.
	 */
	const senderOf = (draft: Draft): MailAddress | undefined => {
		const identity = identities.find((i) => i.id === draft.identityId) ?? identities[0]!;
		const own = { name: identity.name, email: identity.email };
		return [draft.from, own].find((address) => address && !isWildcardAddress(address.email));
	};
	/** Removes the saved draft that a save or a send replaces; returns its id for the change feed. */
	const dropDraft = (draft: Draft): string[] =>
		draft.id && messages.delete(draft.id) ? [draft.id] : [];
	const addKeyword = (id: string | undefined, keyword: string): void => {
		const target = id ? messages.get(id) : undefined;
		if (target) messages.set(id!, { ...target, keywords: { ...target.keywords, [keyword]: true } });
	};
	const rawBytes = (target: MailMessage): Uint8Array =>
		writeEmail(
			{
				from: target.from[0] ?? { name: '', email: account.name },
				to: target.to,
				cc: target.cc,
				bcc: target.bcc,
				replyTo: target.replyTo,
				subject: target.subject,
				text: target.text ?? '',
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

	const transport: MemoryTransport = {
		kind: 'memory',
		async connect() {
			await settle();
			return { account, identities, canSend: true };
		},
		async mailboxes() {
			await settle();
			return withCounts(mailboxes.values(), messages.values());
		},
		async createMailbox(input) {
			await settle();
			const mailbox = mailboxOf({
				id: nextId('f', mailboxes),
				name: input.name,
				parentId: input.parentId ?? null,
				role: input.role ?? null,
			});
			mailboxes.set(mailbox.id, mailbox);
			emit({ type: 'mailboxes' });
			return mailbox;
		},
		async renameMailbox(id, name) {
			await settle();
			const mailbox = mailboxes.get(id);
			if (!mailbox) throw new MailTransportError('notFound', `No mailbox ${id}.`);
			mailboxes.set(id, { ...mailbox, name });
			emit({ type: 'mailboxes' });
		},
		async destroyMailbox(id) {
			await settle();
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
			emit({ type: 'mailboxes' });
		},
		async query(query, page = {}) {
			await settle();
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
			await settle();
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
			await settle();
			return message(id);
		},
		async update(patches) {
			await settle();
			const updated: string[] = [];
			for (const [id, patch] of Object.entries(patches) as [string, EmailPatch][]) {
				const target = message(id);
				const keywords: Record<string, true> = { ...target.keywords };
				for (const [keyword, on] of Object.entries(patch.keywords ?? {}))
					if (on) keywords[keyword] = true;
					else delete keywords[keyword];
				const boxes = new Set(target.mailboxIds);
				for (const [box, on] of Object.entries(patch.mailboxIds ?? {})) {
					if (on && !mailboxes.has(box))
						throw new MailTransportError('notFound', `No mailbox ${box}.`);
					if (on) boxes.add(box);
					else boxes.delete(box);
				}
				if (!boxes.size)
					throw new MailTransportError('invalid', 'A message must stay in a mailbox.');
				messages.set(id, { ...target, keywords, mailboxIds: [...boxes] });
				updated.push(id);
			}
			if (updated.length) emailsChanged([], updated, []);
		},
		async destroy(ids) {
			await settle();
			const destroyed = ids.filter((id) => messages.delete(id));
			if (destroyed.length) emailsChanged([], [], destroyed);
		},
		async saveDraft(draft) {
			await settle();
			const from = senderOf(draft);
			const id = nextId('d', messages);
			messages.set(
				id,
				messageFromDraft(draft, id, {
					mailboxId: byRole('drafts').id,
					sent: false,
					now: now(),
					from,
					blobs,
				}),
			);
			emailsChanged([id], [], dropDraft(draft));
			return { id };
		},
		async send(draft) {
			await settle();
			const recipients = draftRecipients(draft);
			if (!recipients.length)
				throw new MailTransportError('invalid', 'The message has no recipients.');
			const from = senderOf(draft);
			const id = nextId('s', messages);
			const sent = messageFromDraft(draft, id, {
				mailboxId: byRole('sent').id,
				sent: true,
				now: now(),
				from,
				blobs,
			});
			messages.set(id, sent);
			const created = [id];
			if (recipients.some((address) => own.has(address.email.toLowerCase()))) {
				const copy = nextId('m', messages);
				messages.set(copy, {
					...sent,
					id: copy,
					blobId: `${copy}-raw`,
					mailboxIds: [byRole('inbox').id],
					keywords: {},
					bcc: [],
				});
				created.push(copy);
			}
			const destroyed = dropDraft(draft);
			addKeyword(draft.replyToEmailId, ANSWERED);
			addKeyword(draft.forwardOfEmailId, FORWARDED);
			const updated = [draft.replyToEmailId, draft.forwardOfEmailId].filter(
				(x): x is string => !!x,
			);
			emailsChanged(created, updated, destroyed);
			return { id };
		},
		async upload(bytes, type) {
			await settle();
			const blobId = nextId('b', blobs);
			blobs.set(blobId, { bytes: bytes.slice(), type });
			return { blobId, type, size: bytes.length };
		},
		async download(blobId) {
			await settle();
			const blob = blobs.get(blobId);
			if (blob) return blob.bytes.slice();
			const owner = [...messages.values()].find((m) => m.blobId === blobId);
			if (!owner) throw new MailTransportError('notFound', `No blob ${blobId}.`);
			return rawBytes(owner);
		},
		async importMessage(bytes, mailboxId) {
			await settle();
			if (!mailboxes.has(mailboxId))
				throw new MailTransportError('notFound', `No mailbox ${mailboxId}.`);
			const id = nextId('i', messages);
			const imported = messageFromRaw(bytes, id, { mailboxId, now: now(), blobs });
			messages.set(id, { ...imported, keywords: { [SEEN]: true } });
			emailsChanged([id], [], []);
			return { id };
		},
		watch(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		close() {
			closed = true;
			listeners.clear();
		},
		deliver(seed) {
			const id = seed.id ?? nextId('m', messages);
			messages.set(id, messageFromSeed(seed, id, blobs));
			emailsChanged([id], [], []);
			return id;
		},
	};
	return transport;
}
