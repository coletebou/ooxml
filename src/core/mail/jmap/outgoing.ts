// The Email a draft becomes (RFC 8621 4.6 creation rules): addresses, the threading headers, one
// `text/plain` part, one `text/html` part when the draft has rich text, attachments by blob id
// (the pictures the HTML shows inline, with their Content-ID), and the identity it is written as.
// New code.
import {
	identityFor,
	isWildcardAddress,
	type Draft,
	type Identity,
	type MailAddress,
} from '../model';
import { toJmapAddresses } from './convert';

export { identityCovers } from '../model';

/** The draft's identity (`identityId`), else the one for its `from`, else the first. */
export function pickIdentity(identities: readonly Identity[], draft: Draft): Identity | undefined {
	const chosen = identities.find((identity) => identity.id === draft.identityId);
	if (chosen) return chosen;
	return (draft.from ? identityFor(identities, [draft.from]) : undefined) ?? identities[0];
}

/**
 * The sender: the draft's `from`, else the identity's address. A `*@domain` wildcard is never
 * written, wherever it comes from: without a real address the From is left to the server.
 */
function sender(draft: Draft, identity: Identity | undefined): MailAddress | undefined {
	const own = identity ? { name: identity.name, email: identity.email } : undefined;
	return [draft.from, own].find((address) => address && !isWildcardAddress(address.email));
}

const addresses = (list: readonly MailAddress[]) =>
	list.length ? toJmapAddresses(list) : undefined;

/**
 * The `Email/set` create object for `draft`, filed in `mailboxId` with `keywords`. `undefined`
 * values are left out of the JSON.
 */
export function emailToCreate(
	draft: Draft,
	mailboxId: string,
	keywords: readonly string[],
	identity: Identity | undefined,
): Record<string, unknown> {
	const from = sender(draft, identity);
	const html = draft.html || undefined;
	return {
		mailboxIds: { [mailboxId]: true },
		keywords: Object.fromEntries(keywords.map((keyword) => [keyword, true])),
		from: from ? toJmapAddresses([from]) : undefined,
		to: addresses(draft.to),
		cc: addresses(draft.cc),
		bcc: addresses(draft.bcc),
		replyTo: identity ? addresses(identity.replyTo) : undefined,
		subject: draft.subject,
		inReplyTo: draft.inReplyTo?.length ? [...draft.inReplyTo] : undefined,
		references: draft.references?.length ? [...draft.references] : undefined,
		bodyValues: { text: { value: draft.text }, ...(html ? { html: { value: html } } : {}) },
		textBody: [{ partId: 'text', type: 'text/plain' }],
		htmlBody: html ? [{ partId: 'html', type: 'text/html' }] : undefined,
		attachments: draft.attachments.length
			? draft.attachments.map((attachment) => ({
					blobId: attachment.blobId,
					type: attachment.type || 'application/octet-stream',
					name: attachment.name,
					disposition: attachment.inline ? 'inline' : 'attachment',
					...(attachment.cid ? { cid: attachment.cid } : {}),
				}))
			: undefined,
	};
}
