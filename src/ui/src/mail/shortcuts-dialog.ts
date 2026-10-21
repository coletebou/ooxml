// The keyboard shortcuts dialog of <mail-app>: every command with its keys (keyboard.ts).
import { html } from 'lit';
import type { MailI18n, MailKey } from './i18n/translator';
import { icon } from './icons';
import { SHORTCUTS, type MailCommand } from './keyboard';

const LABELS: Record<MailCommand, MailKey> = {
	compose: 'shortcut.compose',
	search: 'shortcut.search',
	next: 'shortcut.next',
	previous: 'shortcut.previous',
	open: 'shortcut.open',
	close: 'shortcut.close',
	select: 'shortcut.select',
	selectAll: 'shortcut.selectAll',
	archive: 'shortcut.archive',
	delete: 'shortcut.delete',
	junk: 'shortcut.junk',
	flag: 'shortcut.flag',
	markRead: 'shortcut.markRead',
	markUnread: 'shortcut.markUnread',
	reply: 'shortcut.reply',
	replyAll: 'shortcut.replyAll',
	forward: 'shortcut.forward',
	send: 'shortcut.send',
	help: 'shortcut.help',
};

export function shortcutsDialog(i18n: MailI18n, close: () => void) {
	return html`<div class="overlay" @click=${(e: Event) => e.target === e.currentTarget && close()}>
		<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
			<header>
				<h2 id="shortcuts-title">${i18n.t('shortcut.title')}</h2>
				<button
					type="button"
					class="icon-button"
					aria-label=${i18n.t('notice.dismiss')}
					@click=${close}
					>${icon('close')}</button
				>
			</header>
			<dl class="shortcuts">
				${SHORTCUTS.map(
					({ command, keys }) =>
						html`<dt>${keys.map((key) => html`<kbd>${key}</kbd>`)}</dt
							><dd>${i18n.t(LABELS[command])}</dd>`,
				)}
			</dl>
		</section>
	</div>`;
}
