// Saving drafts and sending in a memory transport: a draft is kept in Drafts in place of the one
// it replaces, a sent message in Sent (and in the Inbox too, when there is one, if it is addressed
// to the person, so a demo can mail itself), and the message it answers or forwards is marked so.
// Split from `memory-transport.ts`. New code.
import { draftRecipients } from './compose';
import { messageFromDraft } from './memory-messages';
import type { MemoryState } from './memory-state';
import {
	ANSWERED,
	FORWARDED,
	isWildcardAddress,
	type Draft,
	type Identity,
	type MailAddress,
} from './model';
import { MailTransportError, type MailTransport } from './transport';

export function createOutgoing(state: MemoryState): Pick<MailTransport, 'saveDraft' | 'send'> {
	const { messages } = state;
	/** The identity a draft is written as: its own, else the first. */
	const identityOf = (draft: Draft): Identity =>
		state.identities.find((i) => i.id === draft.identityId) ?? state.identities[0]!;
	/**
	 * The address a draft is sent from: its own, else its identity's. A `*@domain` wildcard is never
	 * one, as a server would never send from it.
	 */
	const senderOf = (draft: Draft): MailAddress | undefined => {
		const identity = identityOf(draft);
		const own = { name: identity.name, email: identity.email };
		return [draft.from, own].find((address) => address && !isWildcardAddress(address.email));
	};
	/** Removes the saved draft that a save or a send replaces; returns its id for the change feed. */
	const dropDraft = (draft: Draft): string[] =>
		draft.id && messages.delete(draft.id) ? [draft.id] : [];
	/**
	 * A new id for what `draft` becomes: never one stored, and never the draft's own, which may be
	 * gone already (deleted, or from before a reload): `dropDraft` would take the new copy with it.
	 */
	const newId = (prefix: string, draft: Draft): string =>
		state.nextId(prefix, { has: (id) => messages.has(id) || id === draft.id });
	const addKeyword = (id: string | undefined, keyword: string): void => {
		const target = id ? messages.get(id) : undefined;
		if (target) messages.set(id!, { ...target, keywords: { ...target.keywords, [keyword]: true } });
	};

	/** A draft's files must have been uploaded, as a JMAP server asks (`blobNotFound`). */
	const uploaded = (draft: Draft): void => {
		const missing = draft.attachments.find((file) => !state.blobs.has(file.blobId));
		if (missing)
			throw new MailTransportError('notFound', `The file ${missing.name} was not uploaded.`);
	};

	return {
		async saveDraft(draft) {
			await state.settle();
			uploaded(draft);
			const from = senderOf(draft);
			const id = newId('d', draft);
			messages.set(
				id,
				messageFromDraft(draft, id, {
					mailboxId: state.byRole('drafts').id,
					sent: false,
					now: state.now(),
					from,
					replyTo: identityOf(draft).replyTo,
					blobs: state.blobs,
				}),
			);
			state.emailsChanged([id], [], dropDraft(draft));
			return { id };
		},
		async send(draft) {
			await state.settle();
			const recipients = draftRecipients(draft);
			if (!recipients.length)
				throw new MailTransportError('invalid', 'The message has no recipients.');
			uploaded(draft);
			const from = senderOf(draft);
			// Every folder it needs is found before anything is stored, so a send that fails stores
			// nothing. A message to the person's own address arrives in the Inbox too, when there is one.
			const sentBox = state.byRole('sent');
			const toSelf = recipients.some((address) => state.own.has(address.email.toLowerCase()));
			const inbox = toSelf
				? [...state.mailboxes.values()].find((mailbox) => mailbox.role === 'inbox')
				: undefined;
			const id = newId('s', draft);
			const sent = messageFromDraft(draft, id, {
				mailboxId: sentBox.id,
				sent: true,
				now: state.now(),
				from,
				replyTo: identityOf(draft).replyTo,
				blobs: state.blobs,
			});
			messages.set(id, sent);
			const created = [id];
			if (inbox) {
				const copy = newId('m', draft);
				messages.set(copy, {
					...sent,
					id: copy,
					blobId: `${copy}-raw`,
					mailboxIds: [inbox.id],
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
			state.emailsChanged(created, updated, destroyed);
			return { id };
		},
	};
}
