// The compose layer of <mail-app>: the compose window over the app, with each of its events turned
// into a client action. A hand-over names the compose session it is for, and one for a draft that
// gave way to another since is dropped, so a late read or a late Close never acts on the next one.
import { html, nothing } from 'lit';
import type { MailClient, MailState } from 'ooxml-core/mail';

type Files = Parameters<MailClient['attach']>[0];
type Patch = Parameters<MailClient['updateDraft']>[0];

export function composeView(mail: MailClient, state: MailState) {
	if (!state.compose) return nothing;
	/** Run `action` for a hand-over of the open draft; one of a draft that gave way is dropped. */
	const current =
		<T extends { session: number }>(action: (detail: T) => unknown) =>
		(e: CustomEvent<T>): void => {
			if (mail.getState().compose?.session === e.detail.session) void action(e.detail);
		};
	return html`<div class="compose-layer">
		<mail-compose
			.compose=${state.compose}
			.identities=${state.identities}
			.contacts=${state.contacts}
			@mail-draft-change=${(e: CustomEvent<{ patch: Patch }>) => mail.updateDraft(e.detail.patch)}
			@mail-draft-attach=${current((detail: { session: number; files: Files }) => mail.attach(detail.files))}
			@mail-draft-detach=${(e: CustomEvent<{ blobId: string }>) => mail.detach(e.detail.blobId)}
			@mail-draft-send=${current(() => mail.send())}
			@mail-draft-discard=${current(() => mail.discardDraft())}
			@mail-draft-close=${current(() => mail.closeCompose())}
		></mail-compose>
	</div>`;
}
