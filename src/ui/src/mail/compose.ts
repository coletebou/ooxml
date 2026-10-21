// <mail-compose>: the compose window. Rich text is edited in place with the browser's editing
// commands; pasted and quoted HTML go through the message sanitiser first (remote images are
// dropped, so composing never loads a tracker). Every edit is an event; the client saves the draft
// after a quiet moment, and Ctrl/Cmd+Enter sends.
import { html, nothing, type PropertyValues } from 'lit';
import type { ComposeState, Contact, Draft, Identity, MailAddress } from 'ooxml-core/mail';
import { errorText } from './app-text';
import { defineOnce, MailElement, mailStyles } from './base';
import { fileSize } from './format';
import type { MailKey } from './i18n/translator';
import { icon } from './icons';
import { defineMailRecipients } from './recipients';
import { sanitizeEmailHtml } from './sanitize';
import css from './compose.css?raw';

type Patch = Partial<Omit<Draft, 'id' | 'attachments'>>;

const escapeHtml = (text: string): string =>
	text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
/** Plain text as editor HTML (lines become breaks). */
const textHtml = (text: string): string => escapeHtml(text).replace(/\r?\n/g, '<br>');

/** Editing command, glyph, label and command value of each formatting button. */
const FORMATS: readonly { command: string; glyph: string; label: MailKey; value?: string }[] = [
	{ command: 'bold', glyph: 'bold', label: 'compose.bold' },
	{ command: 'italic', glyph: 'italic', label: 'compose.italic' },
	{ command: 'underline', glyph: 'underline', label: 'compose.underline' },
	{ command: 'strikeThrough', glyph: 'strikethrough', label: 'compose.strikethrough' },
	{ command: 'insertUnorderedList', glyph: 'bullets', label: 'compose.bullets' },
	{ command: 'insertOrderedList', glyph: 'mail-numbered', label: 'compose.numbered' },
	{ command: 'formatBlock', glyph: 'mail-quote', label: 'compose.quote', value: 'blockquote' },
	{ command: 'createLink', glyph: 'mail-link', label: 'compose.link' },
	{ command: 'removeFormat', glyph: 'mail-clear-format', label: 'compose.clearFormat' },
];

export class MailCompose extends MailElement {
	static override styles = mailStyles(css);
	static override properties = {
		...MailElement.properties,
		compose: { attribute: false },
		identities: { attribute: false },
		contacts: { attribute: false },
		showCc: { state: true },
		showBcc: { state: true },
		dragging: { state: true },
	};
	declare compose: ComposeState | null;
	declare identities: readonly Identity[];
	declare contacts: readonly Contact[];
	declare showCc: boolean;
	declare showBcc: boolean;
	declare dragging: boolean;
	/** The compose session the editor holds, so updates of the same draft keep the caret. */
	private session = 0;

	constructor() {
		super();
		this.compose = null;
		this.identities = [];
		this.contacts = [];
		this.showCc = false;
		this.showBcc = false;
		this.dragging = false;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		defineMailRecipients();
	}

	private get editor(): HTMLElement | null {
		return this.renderRoot.querySelector<HTMLElement>('.editor');
	}

	protected override updated(changed: PropertyValues<this>): void {
		const compose = this.compose;
		const editor = this.editor;
		if (!compose || !editor || !changed.has('compose')) return;
		if (compose.session === this.session) return;
		this.session = compose.session;
		const draft = compose.draft;
		editor.innerHTML = draft.html
			? sanitizeEmailHtml(draft.html, { allowRemote: false }).body
			: textHtml(draft.text);
		this.showCc ||= draft.cc.length > 0;
		this.showBcc ||= draft.bcc.length > 0;
		const focus = draft.to.length
			? editor
			: this.renderRoot.querySelector<HTMLElement>('mail-recipients');
		focus?.focus();
		if (focus === editor) this.caretToStart(editor);
	}

	private caretToStart(editor: HTMLElement): void {
		const selection = this.ownerDocument.getSelection();
		if (!selection) return;
		const range = this.ownerDocument.createRange();
		range.setStart(editor, 0);
		range.collapse(true);
		selection.removeAllRanges();
		selection.addRange(range);
	}

	private change(patch: Patch): void {
		this.emit('mail-draft-change', { patch });
	}

	/** The editor's content as the draft's HTML and plain text. */
	private edited(): void {
		const editor = this.editor;
		if (!editor) return;
		this.change({ html: editor.innerHTML, text: editor.innerText.replace(/\n{3,}/g, '\n\n') });
	}

	private format(command: string, value?: string): void {
		this.editor?.focus();
		if (command === 'createLink') {
			const url = globalThis.prompt?.(this.t('compose.linkPrompt'), 'https://');
			if (!url || !/^(https?:|mailto:)/i.test(url.trim())) return;
			value = url.trim();
		}
		this.ownerDocument.execCommand(command, false, value);
		this.edited();
	}

	private paste(event: ClipboardEvent): void {
		const markup = event.clipboardData?.getData('text/html');
		if (!markup) return;
		event.preventDefault();
		const clean = sanitizeEmailHtml(markup, { allowRemote: false }).body;
		this.ownerDocument.execCommand('insertHTML', false, clean);
		this.edited();
	}

	private async attachFiles(list: FileList | null | undefined): Promise<void> {
		const files = await Promise.all(
			[...(list ?? [])].map(async (file) => ({
				name: file.name,
				type: file.type,
				bytes: new Uint8Array(await file.arrayBuffer()),
			})),
		);
		if (files.length) this.emit('mail-draft-attach', { files });
	}

	private status(compose: ComposeState): string {
		if (compose.uploading) return this.tn('compose.uploading', compose.uploading);
		switch (compose.status) {
			case 'saving':
				return this.t('compose.saving');
			case 'sending':
				return this.t('compose.sending');
			case 'saved':
				return compose.savedAt
					? this.t('compose.savedAt', {
							time: new Date(compose.savedAt).toLocaleTimeString(this.i18n.intl, {
								hour: 'numeric',
								minute: '2-digit',
							}),
						})
					: this.t('compose.savedDraft');
			case 'error':
				return compose.error === 'invalid'
					? this.t('compose.checkRecipients')
					: errorText(compose.error ?? 'server', this.i18n);
			default:
				return '';
		}
	}

	private field(label: string, key: 'to' | 'cc' | 'bcc', addresses: readonly MailAddress[]) {
		return html`<mail-recipients
			.label=${label}
			.addresses=${addresses}
			.contacts=${this.contacts}
			@mail-recipients-change=${(e: CustomEvent<{ addresses: MailAddress[] }>) => this.change({ [key]: e.detail.addresses })}
		></mail-recipients>`;
	}

	protected override render() {
		const compose = this.compose;
		if (!compose) return nothing;
		const draft = compose.draft;
		const title = this.t(
			compose.mode === 'reply' || compose.mode === 'replyAll'
				? 'compose.titleReply'
				: compose.mode === 'forward'
					? 'compose.titleForward'
					: 'compose.titleNew',
		);
		return html`<section
			class=${`compose${this.dragging ? ' dragging' : ''}`}
			role="dialog"
			aria-label=${title}
			@dragover=${(e: DragEvent) => {
				if (!e.dataTransfer?.types.includes('Files')) return;
				e.preventDefault();
				this.dragging = true;
			}}
			@dragleave=${() => (this.dragging = false)}
			@drop=${(e: DragEvent) => {
				if (!e.dataTransfer?.files.length) return;
				e.preventDefault();
				this.dragging = false;
				void this.attachFiles(e.dataTransfer.files);
			}}
		>
			<header>
				<h2>${draft.subject || title}</h2>
				<button
					type="button"
					class="icon-button"
					aria-label=${this.t('compose.close')}
					title=${this.t('compose.close')}
					@click=${() => this.emit('mail-draft-close', {})}
					>${icon('close')}</button
				>
			</header>
			${
				this.identities.length > 1
					? html`<label class="from"
							><span>${this.t('compose.from')}</span>
							<select
								.value=${draft.identityId ?? this.identities[0]!.id}
								@change=${(e: Event) => {
									const identity = this.identities.find(
										(i) => i.id === (e.currentTarget as HTMLSelectElement).value,
									);
									if (identity)
										this.change({
											identityId: identity.id,
											from: { name: identity.name, email: identity.email },
										});
								}}
							>
								${this.identities.map((i) => html`<option value=${i.id}>${i.name ? `${i.name} <${i.email}>` : i.email}</option>`)}
							</select></label
						>`
					: nothing
			}
			<div class="row">
				${this.field(this.t('compose.to'), 'to', draft.to)}
				<span class="cc-toggles">
					${this.showCc ? nothing : html`<button type="button" @click=${() => (this.showCc = true)}>${this.t('compose.cc')}</button>`}
					${this.showBcc ? nothing : html`<button type="button" @click=${() => (this.showBcc = true)}>${this.t('compose.bcc')}</button>`}
				</span>
			</div>
			${this.showCc ? this.field(this.t('compose.cc'), 'cc', draft.cc) : nothing}
			${this.showBcc ? this.field(this.t('compose.bcc'), 'bcc', draft.bcc) : nothing}
			<input
				class="subject"
				.value=${draft.subject}
				placeholder=${this.t('compose.subject')}
				aria-label=${this.t('compose.subject')}
				@input=${(e: Event) => this.change({ subject: (e.currentTarget as HTMLInputElement).value })}
			/>
			<div class="format" role="toolbar" aria-label=${this.t('compose.formatting')}>
				${FORMATS.map(
					(f) =>
						html`<button
							type="button"
							class="icon-button"
							aria-label=${this.t(f.label)}
							title=${this.t(f.label)}
							@mousedown=${(e: Event) => e.preventDefault()}
							@click=${() => this.format(f.command, f.value)}
							>${icon(f.glyph)}</button
						>`,
				)}
			</div>
			<div
				class="editor"
				contenteditable="true"
				role="textbox"
				aria-multiline="true"
				aria-label=${this.t('compose.body')}
				@input=${() => this.edited()}
				@paste=${(e: ClipboardEvent) => this.paste(e)}
			></div>
			${
				draft.attachments.length
					? html`<ul class="files"
							>${draft.attachments.map(
								(a) =>
									html`<li
										>${icon('mail-attach')}<span>${a.name}</span
										><small>${fileSize(a.size, this.i18n)}</small>
										<button
											type="button"
											class="icon-button"
											aria-label=${this.t('compose.removeFile', { name: a.name })}
											@click=${() => this.emit('mail-draft-detach', { blobId: a.blobId })}
											>${icon('close')}</button
										></li
									>`,
							)}</ul
						>`
					: nothing
			}
			<footer>
				<button
					type="button"
					class="send"
					?disabled=${compose.status === 'sending' || compose.uploading > 0}
					@click=${() => this.emit('mail-draft-send', {})}
				>
					${icon('mail-sent')}<span>${this.t('compose.send')}</span>
				</button>
				<label class="icon-button" title=${this.t('compose.attach')}>
					${icon('mail-attach')}<span class="sr-only">${this.t('compose.attach')}</span>
					<input
						type="file"
						multiple
						hidden
						@change=${async (e: Event) => {
							const input = e.currentTarget as HTMLInputElement;
							await this.attachFiles(input.files);
							input.value = '';
						}}
					/>
				</label>
				<span class=${`status${compose.status === 'error' ? ' error' : ''}`} role="status"
					>${this.status(compose)}</span
				>
				<button
					type="button"
					class="icon-button"
					aria-label=${this.t('compose.discard')}
					title=${this.t('compose.discard')}
					@click=${() => this.emit('mail-draft-discard', {})}
					>${icon('trash')}</button
				>
			</footer>
		</section>`;
	}
}

export function defineMailCompose(): void {
	defineOnce('mail-compose', MailCompose);
}
