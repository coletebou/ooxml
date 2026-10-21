// The Mail view of <mail-app>: the top bar (new message, search), the list toolbar, and the folder
// pane, message list and reading pane, with every child event turned into a client action.
import { html, nothing } from 'lit';
import type { MailAttachment, MailClient, MailMessage, MailState } from 'ooxml-core/mail';
import { runCommand } from './app-commands';
import { readFiles } from './attachments';
import { icon } from './icons';
import { folderLabel } from './labels';
import type { MailApp } from './mail-app';

/** Save bytes as a download in the browser. */
export function downloadBytes(doc: Document, bytes: Uint8Array, name: string, type: string): void {
	const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
	const link = doc.createElement('a');
	link.href = url;
	link.download = name;
	link.rel = 'noopener';
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function topbar(app: MailApp, mail: MailClient, state: MailState) {
	const i18n = app.i18nFor();
	return html`<header class="topbar">
		<button
			type="button"
			class="icon-button folders-toggle"
			aria-label=${i18n.t('app.folders')}
			aria-expanded=${app.foldersOpen ? 'true' : 'false'}
			@click=${() => (app.foldersOpen = !app.foldersOpen)}
			>${icon('mail-menu')}</button
		>
		<button
			type="button"
			class="primary"
			aria-label=${i18n.t('app.newMessage')}
			?disabled=${!state.canSend}
			@click=${() => void mail.compose('new')}
		>
			${icon('pencil')}<span>${i18n.t('app.newMessage')}</span>
		</button>
		<form
			class="search"
			role="search"
			@submit=${(e: Event) => {
				e.preventDefault();
				const input = (e.currentTarget as HTMLFormElement).elements.namedItem(
					'q',
				) as HTMLInputElement;
				void mail.search(input.value);
			}}
		>
			${icon('search')}
			<input
				name="q"
				type="search"
				.value=${state.query}
				placeholder=${i18n.t('app.searchPlaceholder')}
				aria-label=${i18n.t('app.search')}
				@search=${(e: Event) => !(e.currentTarget as HTMLInputElement).value && void mail.search('')}
			/>
			<select
				aria-label=${i18n.t('app.searchScope')}
				.value=${state.searchScope}
				@change=${(e: Event) => void mail.setSearchScope((e.currentTarget as HTMLSelectElement).value as 'mailbox' | 'all')}
			>
				<option value="mailbox">${i18n.t('app.scopeFolder')}</option>
				<option value="all">${i18n.t('app.scopeAll')}</option>
			</select>
		</form>
		<span class="account" title=${state.account?.name ?? ''}>${state.account?.name ?? ''}</span>
	</header>`;
}

function listToolbar(app: MailApp, mail: MailClient, state: MailState) {
	const i18n = app.i18nFor();
	const all =
		state.conversations.length > 0 && state.selection.length === state.conversations.length;
	const some = state.selection.length > 0;
	const button = (glyph: string, label: string, run: () => void, disabled = false) =>
		html`<button
			type="button"
			class="icon-button"
			aria-label=${label}
			title=${label}
			?disabled=${disabled}
			@click=${run}
			>${icon(glyph)}</button
		>`;
	return html`<div class="list-toolbar" role="toolbar" aria-label=${i18n.t('app.listActions')}>
		<input
			type="checkbox"
			aria-label=${i18n.t('app.selectAll')}
			.checked=${all}
			.indeterminate=${some && !all}
			@change=${() => (all ? mail.clearSelection() : mail.selectAll())}
		/>
		${button('mail-refresh', i18n.t('app.refresh'), () => void mail.refresh())}
		${button('mail-archive', i18n.t('action.archive'), () => runCommand(app, mail, 'archive'), !some)}
		${button('trash', i18n.t('action.delete'), () => runCommand(app, mail, 'delete'), !some)}
		${button('mail-junk', i18n.t('action.junk'), () => runCommand(app, mail, 'junk'), !some)}
		${button('mail-open', i18n.t('action.markRead'), () => void mail.markRead(true), !some)}
		${button('mail-envelope', i18n.t('action.markUnread'), () => void mail.markRead(false), !some)}
		${button('mail-flag', i18n.t('action.flag'), () => void mail.toggleFlagged(), !some)}
		<span class="toolbar-spacer"></span>
		${some ? html`<span class="selected-count">${i18n.tn('app.selected', state.selection.length)}</span>` : nothing}
		<label class="toggle" title=${i18n.t('app.threadedHint')}>
			<input
				type="checkbox"
				.checked=${state.threaded}
				@change=${(e: Event) => mail.setThreaded((e.currentTarget as HTMLInputElement).checked)}
			/>
			<span>${i18n.t('app.threaded')}</span>
		</label>
		<label class="icon-button" title=${i18n.t('app.importEml')}>
			${icon('mail-import')}<span class="sr-only">${i18n.t('app.importEml')}</span>
			<input
				type="file"
				accept=".eml,message/rfc822"
				multiple
				hidden
				@change=${async (e: Event) => {
					const input = e.currentTarget as HTMLInputElement;
					await mail.importEml(await readFiles(input.files));
					input.value = '';
				}}
			/>
		</label>
	</div>`;
}

export function mailView(app: MailApp, mail: MailClient, state: MailState) {
	const current = state.mailboxes.find((m) => m.id === state.mailboxId);
	const role = current?.role ?? null;
	const showRecipients = role === 'sent' || role === 'drafts';
	const me = state.identities.map((identity) => identity.email);
	const i18n = app.i18nFor();
	const listLabel = current ? folderLabel(current, i18n) : i18n.t('app.mail');
	return html`${topbar(app, mail, state)}
		<div class=${`panes${state.open ? ' reading' : ''}${app.foldersOpen ? ' folders-open' : ''}`}>
			<mail-folder-pane
				.mailboxes=${state.mailboxes}
				.selected=${state.mailboxId ?? ''}
				@mail-select-mailbox=${(e: CustomEvent<{ id: string }>) => {
					app.foldersOpen = false;
					void mail.selectMailbox(e.detail.id);
				}}
				@mail-create-folder=${(e: CustomEvent<{ name: string }>) => void mail.createMailbox(e.detail.name)}
				@mail-rename-folder=${(e: CustomEvent<{ id: string; name: string }>) => void mail.renameMailbox(e.detail.id, e.detail.name)}
				@mail-delete-folder=${(e: CustomEvent<{ id: string; name: string }>) => {
					const question = i18n.t('folder.confirmDelete', { name: e.detail.name });
					if (globalThis.confirm?.(question) !== false) void mail.deleteMailbox(e.detail.id);
				}}
				@mail-move=${(e: CustomEvent<{ mailboxId: string; ids: string[] }>) => void mail.moveTo(e.detail.mailboxId, e.detail.ids)}
			></mail-folder-pane>
			<section class="list-pane" aria-label=${listLabel}>
				${listToolbar(app, mail, state)}
				<mail-message-list
					.conversations=${state.conversations}
					.selection=${state.selection}
					.focused=${state.focusedId ?? ''}
					.openId=${state.open?.id ?? ''}
					.loading=${state.loading}
					.total=${state.total}
					.loaded=${state.loaded}
					.recipients=${showRecipients}
					.searching=${!!state.query}
					@mail-open=${(e: CustomEvent<{ id: string }>) => {
						const conversation = state.conversations.find((c) => c.id === e.detail.id);
						if (conversation?.draft && conversation.count === 1 && role === 'drafts')
							void mail.editDraft(conversation.emailIds[0]!);
						else void mail.open(e.detail.id);
					}}
					@mail-toggle-select=${(e: CustomEvent<{ id: string }>) => mail.toggleSelected(e.detail.id)}
					@mail-select-range=${(e: CustomEvent<{ id: string }>) => mail.selectRange(e.detail.id)}
					@mail-flag=${(e: CustomEvent<{ id: string; flagged: boolean }>) => void mail.setFlagged(e.detail.flagged, [e.detail.id])}
					@mail-load-more=${() => void mail.loadMore()}
				></mail-message-list>
			</section>
			<mail-reading-pane
				.conversation=${state.open}
				.mailboxes=${state.mailboxes}
				.me=${me}
				.inlineUrls=${(message: MailMessage) => app.inlineUrls(message)}
				@mail-action=${(e: CustomEvent<{ action: string; id: string }>) => app.readingAction(e.detail.action, e.detail.id)}
				@mail-move=${(e: CustomEvent<{ mailboxId: string; ids: string[] }>) => void mail.moveTo(e.detail.mailboxId, e.detail.ids)}
				@mail-reply=${(e: CustomEvent<{ emailId: string; mode: 'reply' | 'replyAll' | 'forward' }>) => void mail.compose(e.detail.mode, e.detail.emailId)}
				@mail-edit-draft=${(e: CustomEvent<{ emailId: string }>) => void mail.editDraft(e.detail.emailId)}
				@mail-export=${async (e: CustomEvent<{ emailId: string }>) => {
					const file = await mail.exportEml(e.detail.emailId).catch(() => null);
					if (file) downloadBytes(app.ownerDocument, file.bytes, file.name, file.type);
				}}
				@mail-attachment=${async (
					e: CustomEvent<{
						action: 'preview' | 'download';
						attachment: MailAttachment;
						emailId: string;
					}>,
				) => {
					if (e.detail.action === 'preview')
						return app.openAttachment(e.detail.emailId, e.detail.attachment);
					const bytes = await mail.download(e.detail.attachment).catch(() => null);
					if (bytes)
						downloadBytes(
							app.ownerDocument,
							bytes,
							e.detail.attachment.name,
							e.detail.attachment.type,
						);
				}}
				@mail-mailto=${(e: CustomEvent<{ href: string }>) => app.mailto(e.detail.href)}
			></mail-reading-pane>
		</div>`;
}
