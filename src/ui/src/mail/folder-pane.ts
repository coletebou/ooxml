// <mail-folder-pane>: the folder list. Special-use folders show under their localised names (the
// server's names are often in another language); the person's own folders can be created, renamed
// and deleted in place, and messages dragged from the list drop onto a folder to move there.
import { html, nothing, type PropertyValues } from 'lit';
import type { MailboxView } from 'ooxml-core/mail';
import { defineOnce, MailElement, mailStyles } from './base';
import { icon, mailboxIcon } from './icons';
import { isCancelKey } from './keyboard';
import { folderLabel } from './labels';
import css from './folder-pane.css?raw';

/** The `DataTransfer` type a message row carries: JSON conversation ids. */
export const MAIL_DRAG_TYPE = 'application/x-ooxml-mail-ids';

export class MailFolderPane extends MailElement {
	static override styles = mailStyles(css);
	static override properties = {
		...MailElement.properties,
		mailboxes: { attribute: false },
		selected: { type: String },
		editing: { state: true },
		creating: { state: true },
		dropTarget: { state: true },
	};
	declare mailboxes: readonly MailboxView[];
	declare selected: string;
	/** The folder being renamed. */
	declare editing: string;
	declare creating: boolean;
	declare dropTarget: string;

	constructor() {
		super();
		this.mailboxes = [];
		this.selected = '';
		this.editing = '';
		this.creating = false;
		this.dropTarget = '';
	}

	protected override updated(changed: PropertyValues<this>): void {
		if ((changed.has('editing') && this.editing) || (changed.has('creating') && this.creating))
			this.renderRoot.querySelector<HTMLInputElement>('input')?.focus();
	}

	private commit(event: Event, id: string | null): void {
		event.preventDefault();
		const input = (event.currentTarget as HTMLFormElement).elements.namedItem(
			'name',
		) as HTMLInputElement;
		const name = input.value.trim();
		if (name) {
			if (id) this.emit('mail-rename-folder', { id, name });
			else this.emit('mail-create-folder', { name });
		}
		this.editing = '';
		this.creating = false;
	}

	private drop(event: DragEvent, mailbox: MailboxView): void {
		this.dropTarget = '';
		const raw = event.dataTransfer?.getData(MAIL_DRAG_TYPE);
		if (!raw) return;
		event.preventDefault();
		try {
			const ids = JSON.parse(raw) as unknown;
			if (Array.isArray(ids) && ids.every((id) => typeof id === 'string'))
				this.emit('mail-move', { mailboxId: mailbox.id, ids });
		} catch {
			// Not ours: ignore.
		}
	}

	private row(mailbox: MailboxView) {
		const name = folderLabel(mailbox, this.i18n);
		if (this.editing === mailbox.id)
			return html`<li>
				<form class="edit" @submit=${(e: Event) => this.commit(e, mailbox.id)}>
					<input
						name="name"
						.value=${mailbox.name}
						aria-label=${this.t('folder.renameLabel')}
						@keydown=${(e: KeyboardEvent) => isCancelKey(e) && (this.editing = '')}
					/>
				</form>
			</li>`;
		const current = mailbox.id === this.selected;
		return html`<li
			class=${this.dropTarget === mailbox.id ? 'drop' : ''}
			@dragover=${(e: DragEvent) => {
				if (!e.dataTransfer?.types.includes(MAIL_DRAG_TYPE)) return;
				e.preventDefault();
				this.dropTarget = mailbox.id;
			}}
			@dragleave=${() => (this.dropTarget = '')}
			@drop=${(e: DragEvent) => this.drop(e, mailbox)}
		>
			<button
				type="button"
				class="folder"
				style=${`--depth:${mailbox.depth}`}
				aria-current=${current ? 'page' : 'false'}
				@click=${() => this.emit('mail-select-mailbox', { id: mailbox.id })}
			>
				${icon(mailboxIcon(mailbox.role))}<span class="name">${name}</span>${
					mailbox.unreadEmails && mailbox.role !== 'sent' && mailbox.role !== 'trash'
						? html`<span class="count" aria-label=${this.tn('folder.unread', mailbox.unreadEmails)}
								>${mailbox.unreadEmails}</span
							>`
						: nothing
				}
			</button>
			${
				mailbox.role
					? nothing
					: html`<span class="tools">
							<button
								type="button"
								title=${this.t('folder.rename', { name })}
								aria-label=${this.t('folder.rename', { name })}
								@click=${() => (this.editing = mailbox.id)}
								>${icon('pencil')}</button
							>
							<button
								type="button"
								title=${this.t('folder.delete', { name })}
								aria-label=${this.t('folder.delete', { name })}
								@click=${() => this.emit('mail-delete-folder', { id: mailbox.id, name })}
								>${icon('trash')}</button
							>
						</span>`
			}
		</li>`;
	}

	protected override render() {
		return html`<nav aria-label=${this.t('folder.label')}>
			<ul>
				${this.mailboxes.map((mailbox) => this.row(mailbox))}
			</ul>
			${
				this.creating
					? html`<form class="edit" @submit=${(e: Event) => this.commit(e, null)}>
							<input
								name="name"
								placeholder=${this.t('folder.newPlaceholder')}
								aria-label=${this.t('folder.newLabel')}
								@keydown=${(e: KeyboardEvent) => isCancelKey(e) && (this.creating = false)}
								@blur=${(e: FocusEvent) => !(e.target as HTMLInputElement).value && (this.creating = false)}
							/>
						</form>`
					: html`<button type="button" class="new" @click=${() => (this.creating = true)}>
							${icon('plus')}<span>${this.t('folder.new')}</span>
						</button>`
			}
		</nav>`;
	}
}

export function defineMailFolderPane(): void {
	defineOnce('mail-folder-pane', MailFolderPane);
}
