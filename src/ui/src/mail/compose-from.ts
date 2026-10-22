// The From field of <mail-compose>: which of the person's identities a draft is sent as. A
// `*@domain` identity may write as any address of its domain but is no address itself (RFC 8621
// section 6), so the draft never takes the wildcard: picking one keeps the address the draft is
// written from when the identity covers it, else leaves the From unset for the transport, and the
// picker names it by that address, or else by its domain. New code.
import { html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import {
	identityCovers,
	isWildcardAddress,
	type Draft,
	type Identity,
	type MailAddress,
} from 'ooxml-core/mail';
import type { MailI18n } from './i18n/translator';

/** What picking an identity changes: its id, and the address to write from (`undefined`: none). */
export interface SenderChange {
	identityId: string;
	from: MailAddress | undefined;
}

/** The address `identity` writes the draft from: its own, else for a wildcard the draft's. */
function senderAddress(identity: Identity, from: MailAddress | undefined): string | null {
	if (!isWildcardAddress(identity.email)) return identity.email;
	return from && !isWildcardAddress(from.email) && identityCovers(identity, from.email)
		? from.email
		: null;
}

/** What picking `identity` changes in a draft written from `from`. */
export function pickSender(identity: Identity, from: MailAddress | undefined): SenderChange {
	const email = senderAddress(identity, from);
	return { identityId: identity.id, from: email ? { name: identity.name, email } : undefined };
}

/**
 * How the picker names `identity`: by its name and the address it writes from (for a wildcard,
 * the draft's own when it is the one `chosen`), else by the domain it may write from.
 */
function senderLabel(
	identity: Identity,
	from: MailAddress | undefined,
	chosen: boolean,
	i18n: MailI18n,
): string {
	const email = chosen || !isWildcardAddress(identity.email) ? senderAddress(identity, from) : null;
	if (email) return identity.name ? `${identity.name} <${email}>` : email;
	const domain = identity.email.trim().slice(2);
	return identity.name
		? i18n.t('compose.fromNamedAnyAddress', { name: identity.name, domain })
		: i18n.t('compose.fromAnyAddress', { domain });
}

/** The From picker, when the person has more than one identity; `pick` gets what a pick changes. */
export function fromPicker(
	identities: readonly Identity[],
	draft: Draft,
	i18n: MailI18n,
	pick: (change: SenderChange) => void,
) {
	if (identities.length < 2) return nothing;
	// Each option says whether it is the sender: the select's own value is set before its options
	// exist on the first render, and `live` sets it again once the person picked another.
	const sender = draft.identityId ?? identities[0]?.id;
	return html`<label class="from"
		><span>${i18n.t('compose.from')}</span>
		<select
			.value=${live(sender)}
			@change=${(e: Event) => {
				const id = (e.currentTarget as HTMLSelectElement).value;
				const identity = identities.find((i) => i.id === id);
				if (identity) pick(pickSender(identity, draft.from));
			}}
		>
			${identities.map((i) => html`<option value=${i.id} ?selected=${i.id === sender}>${senderLabel(i, draft.from, i.id === sender, i18n)}</option>`)}
		</select></label
	>`;
}
