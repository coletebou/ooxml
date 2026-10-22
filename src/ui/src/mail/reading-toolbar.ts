// The toolbar of <mail-reading-pane>: Back, then what can be done with the open conversation as a
// whole (archive, delete, junk, mark as unread, flag, move to a folder). It only says what was
// chosen; the pane turns that into its events.
import { html } from 'lit';
import { FLAGGED, type MailboxView, type OpenConversationView } from 'ooxml-core/mail';
import type { MailI18n } from './i18n/translator';
import { icon } from './icons';
import { folderLabel } from './labels';

export interface ToolbarHandlers {
	/** A button: `close` (back to the list), `archive`, `delete`, `junk`, `unread` or `flag`. */
	act(action: string): void;
	/** The folder picked to move the conversation to. */
	move(mailboxId: string): void;
}

/** The toolbar of `conversation`, whose move menu lists `mailboxes`, each indented by its depth. */
export function conversationToolbar(
	conversation: OpenConversationView,
	mailboxes: readonly MailboxView[],
	i18n: MailI18n,
	handlers: ToolbarHandlers,
) {
	const button = (action: string, glyph: string, label: string) =>
		html`<button
			type="button"
			aria-label=${label}
			title=${label}
			@click=${() => handlers.act(action)}
			>${icon(glyph)}</button
		>`;
	// Flag takes the flag off when a message of the conversation has one.
	const flagged = conversation.messages.some((m) => m.summary.keywords[FLAGGED]);
	return html`<div class="toolbar" role="toolbar" aria-label=${i18n.t('reading.actions')}>
		${button('close', 'chevronLeft', i18n.t('reading.back'))}
		${button('archive', 'mail-archive', i18n.t('action.archive'))}
		${button('delete', 'trash', i18n.t('action.delete'))}
		${button('junk', 'mail-junk', i18n.t('action.junk'))}
		${button('unread', 'mail-envelope', i18n.t('action.markUnread'))}
		${button('flag', 'mail-flag', i18n.t(flagged ? 'action.unflag' : 'action.flag'))}
		<select
			aria-label=${i18n.t('action.moveTo')}
			@change=${(e: Event) => {
				const select = e.currentTarget as HTMLSelectElement;
				if (select.value) handlers.move(select.value);
				select.value = '';
			}}
		>
			<option value="">${i18n.t('action.moveTo')}</option>
			${mailboxes.map((m) => html`<option value=${m.id}>${'\u00a0'.repeat(m.depth * 2)}${folderLabel(m, i18n)}</option>`)}
		</select>
	</div>`;
}
