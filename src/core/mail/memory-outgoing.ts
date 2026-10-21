// Saving drafts and sending in a memory transport: a draft is kept in Drafts in place of the one
// it replaces, a sent message in Sent (and in the Inbox too when it is addressed to the person, so
// a demo can mail itself), and the message it answers or forwards is marked so. Split from
// `memory-transport.ts`. New code.
import { draftRecipients } from './compose';
import { messageFromDraft } from './memory-messages';
import type { MemoryState } from './memory-state';
import { ANSWERED, FORWARDED, isWildcardAddress, type Draft, type MailAddress } from './model';
import { MailTransportError, type MailTransport } from './transport';

export function createOutgoing(state: MemoryState): Pick<MailTransport, 'saveDraft' | 'send'> {
	const { messages } = state;
	/**
	 * The address a draft is sent from: its own, else its identity's, else the first identity's. A
	 * `*@domain` wildcard is never one, as a server would never send from it.
	 */
	const senderOf = (draft: Draft): MailAddress | undefined => {
		const identity =
			state.identities.find((i) => i.id === draft.identityId) ?? state.identities[0]!;
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

	return {
		async saveDraft(draft) {
			await state.settle();
			const from = senderOf(draft);
			const id = state.nextId('d', messages);
			messages.set(
				id,
				messageFromDraft(draft, id, {
					mailboxId: state.byRole('drafts').id,
					sent: false,
					now: state.now(),
					from,
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
			const from = senderOf(draft);
			const id = state.nextId('s', messages);
			const sent = messageFromDraft(draft, id, {
				mailboxId: state.byRole('sent').id,
				sent: true,
				now: state.now(),
				from,
				blobs: state.blobs,
			});
			messages.set(id, sent);
			const created = [id];
			if (recipients.some((address) => state.own.has(address.email.toLowerCase()))) {
				const copy = state.nextId('m', messages);
				messages.set(copy, {
					...sent,
					id: copy,
					blobId: `${copy}-raw`,
					mailboxIds: [state.byRole('inbox').id],
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
