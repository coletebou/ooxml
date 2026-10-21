// <mail-compose>: the compose window. Rich text is edited in place with the browser's editing
// commands; quoted, pasted and dropped HTML go through the message sanitiser first (see
// compose-editor.ts: remote images are dropped, so composing never loads a tracker). Every edit is
// an event; the client saves the draft after a quiet moment, and Ctrl/Cmd+Enter sends. An address
// still being typed is part of the draft before the window closes or sends (`commitRecipients()`).
// Picked files are read for the draft they were added to (`compose-files.ts`): Send stays off while
// they are read, Close waits for them, and Discard drops them. Each hand-over names its session.
import { html, nothing, type PropertyValues } from 'lit';
import { live } from 'lit/directives/live.js';
import type {
	ComposeMode,
	ComposeState,
	Contact,
	Draft,
	Identity,
	MailAddress,
} from 'ooxml-core/mail';
import { composeStatus } from './app-text';
import { defineOnce, MailElement, mailStyles } from './base';
import { caretToStart, dropClean, editorHtml, pasteClean } from './compose-editor';
import { FileReads, fileList } from './compose-files';
import type { MailKey } from './i18n/translator';
import { icon } from './icons';
import { defineMailRecipients, type MailRecipients } from './recipients';
import css from './compose.css?raw';

type Patch = Partial<Omit<Draft, 'id' | 'attachments'>>;

/** The title of the compose window in each mode. */
const TITLES: Record<ComposeMode, MailKey> = {
	new: 'compose.titleNew',
	reply: 'compose.titleReply',
	replyAll: 'compose.titleReply',
	forward: 'compose.titleForward',
};

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
		reading: { state: true },
	};
	declare compose: ComposeState | null;
	declare identities: readonly Identity[];
	declare contacts: readonly Contact[];
	declare showCc: boolean;
	declare showBcc: boolean;
	declare dragging: boolean;
	/** Picked or dropped files still being read, which are not in the draft yet. */
	declare reading: number;
	/** The compose session the editor holds, so updates of the same draft keep the caret. */
	private session = 0;
	/** A drag started in the editor: a move of its own content, which the browser does. */
	private moving = false;
	private readonly files = new FileReads(
		() => this.compose?.session,
		(files, session) => this.emit('mail-draft-attach', { files, session }),
		(running) => (this.reading = running),
	);

	constructor() {
		super();
		this.compose = null;
		this.identities = [];
		this.contacts = [];
		this.showCc = false;
		this.showBcc = false;
		this.dragging = false;
		this.reading = 0;
	}

	/** Files are still being read: sending now would leave them out. */
	get readingFiles(): boolean {
		return this.reading > 0;
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
		editor.innerHTML = editorHtml(draft);
		this.showCc ||= draft.cc.length > 0;
		this.showBcc ||= draft.bcc.length > 0;
		const focus = draft.to.length
			? editor
			: this.renderRoot.querySelector<HTMLElement>('mail-recipients');
		focus?.focus();
		if (focus === editor) caretToStart(this.ownerDocument, editor);
	}

	private change(patch: Patch): void {
		this.emit('mail-draft-change', { patch });
	}

	/** Turn the addresses still being typed into recipients (a draft change), so nothing is lost. */
	commitRecipients(): void {
		for (const field of this.renderRoot.querySelectorAll<MailRecipients>('mail-recipients'))
			field.commit();
	}

	/**
	 * Close or send the draft with what its address fields hold, once the files still being read are
	 * in it. A window that gave way to another draft meanwhile hands nothing over.
	 */
	private handOver(type: 'mail-draft-close' | 'mail-draft-send'): void {
		const session = this.compose?.session;
		if (session === undefined) return;
		const finish = (): void => {
			if (this.compose?.session !== session) return;
			this.commitRecipients();
			this.emit(type, { session });
		};
		if (this.readingFiles) void this.files.settled().then(finish);
		else finish();
	}

	/** Close the window as its Close button does, once the files still being read are in. */
	close(): void {
		this.handOver('mail-draft-close');
	}

	/** Throw the draft away at once; the files still being read for it go nowhere. */
	private discard(): void {
		const session = this.compose?.session;
		if (session === undefined) return;
		this.files.discard(session);
		this.emit('mail-draft-discard', { session });
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

	/** Files dropped anywhere are attached; HTML dropped into the editor goes in clean. */
	private dropped(event: DragEvent): void {
		const files = event.dataTransfer?.files;
		if (files?.length) {
			event.preventDefault();
			this.dragging = false;
			void this.files.read(files);
		} else if (this.editor && dropClean(event, this.editor, this.moving)) this.edited();
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
		const title = this.t(TITLES[compose.mode]);
		// Each option says whether it is the sender: the select's own value is set before its options
		// exist on the first render, and `live` sets it again once the person picked another.
		const sender = draft.identityId ?? this.identities[0]?.id;
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
			@drop=${(e: DragEvent) => this.dropped(e)}
		>
			<header>
				<h2>${draft.subject || title}</h2>
				<button
					type="button"
					class="icon-button"
					aria-label=${this.t('compose.close')}
					title=${this.t('compose.close')}
					@click=${() => this.handOver('mail-draft-close')}
					>${icon('close')}</button
				>
			</header>
			${
				this.identities.length > 1
					? html`<label class="from"
							><span>${this.t('compose.from')}</span>
							<select
								.value=${live(sender)}
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
								${this.identities.map((i) => html`<option value=${i.id} ?selected=${i.id === sender}>${i.name ? `${i.name} <${i.email}>` : i.email}</option>`)}
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
				@paste=${(e: ClipboardEvent) => pasteClean(e, this.ownerDocument) && this.edited()}
				@dragstart=${() => (this.moving = true)}
				@dragend=${() => (this.moving = false)}
			></div>
			${fileList(draft.attachments, this.i18n, (blobId) => this.emit('mail-draft-detach', { blobId }))}
			<footer>
				<button
					type="button"
					class="send"
					?disabled=${compose.status === 'sending' || compose.uploading > 0 || this.readingFiles}
					@click=${() => this.handOver('mail-draft-send')}
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
							await this.files.read(input.files);
							input.value = '';
						}}
					/>
				</label>
				<span class=${`status${compose.status === 'error' ? ' error' : ''}`} role="status"
					>${composeStatus(compose, this.i18n)}</span
				>
				<button
					type="button"
					class="icon-button"
					aria-label=${this.t('compose.discard')}
					title=${this.t('compose.discard')}
					@click=${() => this.discard()}
					>${icon('trash')}</button
				>
			</footer>
		</section>`;
	}
}

export function defineMailCompose(): void {
	defineOnce('mail-compose', MailCompose);
}
