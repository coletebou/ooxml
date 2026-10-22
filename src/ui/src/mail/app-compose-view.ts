// The compose layer of <mail-app>: the compose window over the app, with each of its events turned
// into a client action. Each event names the compose session it is for, and one for a draft that
// gave way to another since is dropped, so a late read, a late Close or an address its field
// commits once the window has gone never acts on the next draft. The window reads the pictures its
// draft shows through the client.
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
	/** Run `action` for an event of the open draft; one for a draft that gave way is dropped. */
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
			@mail-draft-change=${current((detail: { session: number; patch: Patch }) => mail.updateDraft(detail.patch))}
			@mail-draft-attach=${current((detail: { session: number; files: Files }) => mail.attach(detail.files))}
			@mail-draft-detach=${current((detail: { session: number; blobId: string }) => mail.detach(detail.blobId))}
			@mail-draft-send=${current(() => mail.send())}
			@mail-draft-discard=${current(() => mail.discardDraft())}
			@mail-draft-close=${current(() => mail.closeCompose())}
		></mail-compose>
	</div>`;
}
