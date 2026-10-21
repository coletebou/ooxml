// The compose layer of <mail-app>: the compose window over the app, with each of its events turned
// into a client action. A hand-over names the compose session it is for, and one for a draft that
// gave way to another since is dropped, so a late read or a late Close never acts on the next one.
// The window reads the pictures its draft shows through the client.
import { html, nothing } from 'lit';
import type { DraftAttachment, MailClient, MailState } from 'ooxml-core/mail';
import type { DownloadPart } from './compose-pictures';

type Files = Parameters<MailClient['attach']>[0];
type Patch = Parameters<MailClient['updateDraft']>[0];

/** How each client reads a part of a draft (one function per client, so the window keeps it). */
const downloads = new WeakMap<MailClient, DownloadPart>();

function partReader(mail: MailClient): DownloadPart {
	let download = downloads.get(mail);
	if (!download) {
		download = (part: DraftAttachment) =>
			mail
				.download({
					partId: '',
					blobId: part.blobId,
					name: part.name,
					type: part.type,
					size: part.size,
					disposition: part.inline ? 'inline' : 'attachment',
					cid: part.cid ?? null,
				})
				.catch(() => null);
		downloads.set(mail, download);
	}
	return download;
}

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
			.download=${partReader(mail)}
			@mail-draft-change=${(e: CustomEvent<{ patch: Patch }>) => mail.updateDraft(e.detail.patch)}
			@mail-draft-attach=${current((detail: { session: number; files: Files }) => mail.attach(detail.files))}
			@mail-draft-detach=${(e: CustomEvent<{ blobId: string }>) => mail.detach(e.detail.blobId)}
			@mail-draft-send=${current(() => mail.send())}
			@mail-draft-discard=${current(() => mail.discardDraft())}
			@mail-draft-close=${current(() => mail.closeCompose())}
		></mail-compose>
	</div>`;
}
