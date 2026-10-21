// The footer of <mail-compose>: Send, off while the message is on its way and while files are still
// uploading or being read; Attach files, a button that opens the file picker, so the keyboard
// reaches it as it does every other; the draft's status; and Discard. New code.
import { html } from 'lit';
import type { ComposeState } from 'ooxml-core/mail';
import { composeStatus } from './app-text';
import type { MailI18n } from './i18n/translator';
import { icon } from './icons';

export interface ComposeFooterHandlers {
	send(): void;
	/** Files picked to attach. */
	attach(files: FileList | null): Promise<void>;
	discard(): void;
}

/** The footer for `compose`; `readingFiles` is true while picked or dropped files are being read. */
export function composeFooter(
	compose: ComposeState,
	readingFiles: boolean,
	i18n: MailI18n,
	handlers: ComposeFooterHandlers,
) {
	return html`<footer>
		<button
			type="button"
			class="send"
			?disabled=${compose.status === 'sending' || compose.uploading > 0 || readingFiles}
			@click=${() => handlers.send()}
		>
			${icon('mail-sent')}<span>${i18n.t('compose.send')}</span>
		</button>
		<button
			type="button"
			class="icon-button"
			aria-label=${i18n.t('compose.attach')}
			title=${i18n.t('compose.attach')}
			@click=${(e: Event) =>
				(e.currentTarget as HTMLElement).parentElement
					?.querySelector<HTMLInputElement>('input.file')
					?.click()}
			>${icon('mail-attach')}</button
		>
		<input
			class="file"
			type="file"
			multiple
			hidden
			@change=${async (e: Event) => {
				const input = e.currentTarget as HTMLInputElement;
				await handlers.attach(input.files);
				input.value = '';
			}}
		/>
		<span class=${`status${compose.status === 'error' ? ' error' : ''}`} role="status"
			>${composeStatus(compose, i18n)}</span
		>
		<button
			type="button"
			class="icon-button"
			aria-label=${i18n.t('compose.discard')}
			title=${i18n.t('compose.discard')}
			@click=${() => handlers.discard()}
			>${icon('trash')}</button
		>
	</footer>`;
}
