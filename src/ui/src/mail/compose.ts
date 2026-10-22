// <mail-compose>: the compose window. Rich text is edited in place with the browser's editing
// commands; quoted, pasted and dropped HTML go through the message sanitiser first (see
// compose-editor.ts: remote images are dropped, so composing never loads a tracker). Every edit is
// an event; the client saves the draft after a quiet moment, and Ctrl/Cmd+Enter sends. An address
// still being typed is part of the draft before the window closes or sends (`commitRecipients()`).
// Picked files are read for the draft they were added to (`compose-files.ts`): Send stays off while
// they are read, Close (and the app's own hand-overs, `filesRead()`) waits for them, Discard drops
// them, and one the browser cannot read is named (`mail-files-unreadable` `{ names }`). Each edit and each hand-over names its session: an edit can come once its draft has
// gone (an address field commits what it holds a moment after it is left), and is dropped then.
// The pictures the draft's HTML shows by `cid:` show from the bytes `download` reads, and the HTML
// handed back always refers to them by `cid:` (`compose-pictures.ts`).
import { html, nothing, type PropertyValues } from 'lit';
import type {
	ComposeMode,
	ComposeState,
	Contact,
	Draft,
	Identity,
	MailAddress,
} from 'ooxml-core/mail';
import { defineOnce, MailElement, mailStyles } from './base';
import { caretToStart, dropClean, editorHtml, pasteClean } from './compose-editor';
import { FileReads, fileList } from './compose-files';
import { composeFooter, type ComposeFooterHandlers } from './compose-footer';
import { formatBar } from './compose-format';
import { fromPicker } from './compose-from';
import { DraftPictures, listedFiles, type DownloadPart } from './compose-pictures';
import type { MailKey } from './i18n/translator';
import { icon } from './icons';
import { defineMailRecipients, type MailRecipients } from './recipients';
import css from './compose.css?raw';

/** A change to the draft; a field given as `undefined` is unset (the client merges it in). */
type Patch = { [K in keyof Omit<Draft, 'id' | 'attachments'>]?: Draft[K] | undefined };

/** The title of the compose window in each mode. */
const TITLES: Record<ComposeMode, MailKey> = {
	new: 'compose.titleNew',
	reply: 'compose.titleReply',
	replyAll: 'compose.titleReply',
	forward: 'compose.titleForward',
};

export class MailCompose extends MailElement {
	static override styles = mailStyles(css);
	static override properties = {
		...MailElement.properties,
		compose: { attribute: false },
		identities: { attribute: false },
		contacts: { attribute: false },
		download: { attribute: false },
		showCc: { state: true },
		showBcc: { state: true },
		dragging: { state: true },
		reading: { state: true },
	};
	declare compose: ComposeState | null;
	declare identities: readonly Identity[];
	declare contacts: readonly Contact[];
	/** Reads the bytes of a part of the draft, for the pictures its HTML shows; unset, none show. */
	declare download: DownloadPart | null;
	declare showCc: boolean;
	declare showBcc: boolean;
	declare dragging: boolean;
	/** Picked or dropped files still being read, which are not in the draft yet. */
	declare reading: number;
	/**
	 * The compose session the editor holds: an update of the same draft keeps the editor as it is,
	 * caret and all, unless the draft's body changed from elsewhere (`body`).
	 */
	private session = 0;
	/**
	 * The body the editor shows, as it was given or as the editor last handed it over: the same
	 * body coming back is the editor's own edit, and any other was changed from elsewhere.
	 */
	private body: { html: string | undefined; text: string } = { html: undefined, text: '' };
	/** A drag started in the editor: a move of its own content, which the browser does. */
	private moving = false;
	private readonly files = new FileReads(
		() => this.compose?.session,
		(files, session) => this.emit('mail-draft-attach', { files, session }),
		(names) => this.emit('mail-files-unreadable', { names }),
		(running) => (this.reading = running),
	);
	private readonly pictures = new DraftPictures(
		() => this.download,
		() => this.editor,
		() => this.requestUpdate(),
	);
	private readonly footer: ComposeFooterHandlers = {
		send: () => this.handOver('mail-draft-send'),
		attach: (files) => this.files.read(files),
		discard: () => this.discard(),
	};

	constructor() {
		super();
		this.compose = null;
		this.identities = [];
		this.contacts = [];
		this.download = null;
		this.showCc = false;
		this.showBcc = false;
		this.dragging = false;
		this.reading = 0;
	}

	/** Files are still being read: sending now would leave them out. */
	get readingFiles(): boolean {
		return this.reading > 0;
	}

	/** Resolves once the files still being read are handed to the draft they were added to. */
	filesRead(): Promise<void> {
		return this.files.settled();
	}

	override connectedCallback(): void {
		super.connectedCallback();
		defineMailRecipients();
		// Back in a page, it asks again for the pictures it let go when it left.
		if (this.session) this.pictures.mark();
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this.pictures.release();
	}

	private get editor(): HTMLElement | null {
		return this.renderRoot.querySelector<HTMLElement>('.editor');
	}

	private get recipientFields(): NodeListOf<MailRecipients> {
		return this.renderRoot.querySelectorAll<MailRecipients>('mail-recipients');
	}

	protected override willUpdate(changed: PropertyValues<this>): void {
		super.willUpdate(changed);
		// Sending, the fields take nothing (`inert`): the focus goes to the window first, so the
		// browser does not drop it out of the app, where the shortcuts no longer reach.
		const was = changed.get('compose') as ComposeState | null | undefined;
		if (this.compose?.status === 'sending' && was?.status !== 'sending') {
			const section = this.renderRoot.querySelector<HTMLElement>('section');
			const fields = this.renderRoot.querySelector('.fields');
			// The element of this window that holds the focus, an address field's host included.
			const focused = (this.renderRoot as ShadowRoot).activeElement;
			if (section && focused && fields?.contains(focused)) section.focus();
		}
	}

	protected override updated(changed: PropertyValues<this>): void {
		const compose = this.compose;
		const editor = this.editor;
		if (changed.has('compose')) this.pictures.parts = compose?.draft.attachments ?? [];
		if (!compose) {
			// The draft went, and the editor with it: so do its pictures, and the next one loads anew.
			this.session = 0;
			this.pictures.release();
		}
		if (!compose || !editor) return;
		if (compose.session === this.session) {
			if (changed.has('download')) this.pictures.mark();
			// A body the host changed (a link fills a new message in) shows; the editor's own edit
			// coming back is left as it is, with its caret.
			const { html, text, cc, bcc } = compose.draft;
			if (changed.has('compose') && (html !== this.body.html || text !== this.body.text))
				this.show(editor, compose.draft);
			// So do the Cc and Bcc fields once the host puts addresses there: recipients the
			// person cannot see would still be sent the message.
			this.showCc ||= cc.length > 0;
			this.showBcc ||= bcc.length > 0;
			return;
		}
		this.session = compose.session;
		const draft = compose.draft;
		// What was being typed into an address field was for the draft before.
		for (const field of this.recipientFields) field.discardText();
		this.pictures.start(draft.attachments);
		this.show(editor, draft);
		this.showCc ||= draft.cc.length > 0;
		this.showBcc ||= draft.bcc.length > 0;
		const focus = draft.to.length
			? editor
			: this.renderRoot.querySelector<HTMLElement>('mail-recipients');
		focus?.focus();
		if (focus === editor) caretToStart(this.ownerDocument, editor);
	}

	/** Show the body of `draft` in the editor, with its pictures. */
	private show(editor: HTMLElement, draft: Draft): void {
		editor.innerHTML = editorHtml(draft, this.pictures);
		this.body = { html: draft.html, text: draft.text };
		this.pictures.mark();
	}

	/** Change the draft of the session the window shows, which the change names. */
	private change(patch: Patch): void {
		const session = this.compose?.session;
		if (session !== undefined) this.emit('mail-draft-change', { patch, session });
	}

	/** Take a file out of the draft of the session the window shows, which the event names. */
	private detach(blobId: string): void {
		const session = this.compose?.session;
		if (session !== undefined) this.emit('mail-draft-detach', { blobId, session });
	}

	/** Turn the addresses still being typed into recipients (a draft change), so nothing is lost. */
	commitRecipients(): void {
		for (const field of this.recipientFields) field.commit();
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
		if (this.readingFiles) void this.filesRead().then(finish);
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

	/** The editor's content as the draft's HTML (its pictures by `cid:`) and plain text. */
	private edited(): void {
		const editor = this.editor;
		if (!editor) return;
		const text = editor.innerText.replace(/\n{3,}/g, '\n\n');
		const html = this.pictures.read(editor);
		this.body = { html, text };
		this.change({ html, text });
	}

	/** HTML pasted or dropped in: its pictures show, and the draft takes it. */
	private inserted(): void {
		this.pictures.mark();
		this.edited();
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
			// Being sent, the message takes no more files (the browser still does not open them).
			if (this.compose?.status !== 'sending') void this.files.read(files);
		} else if (this.editor && dropClean(event, this.editor, this.moving, this.pictures))
			this.inserted();
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
		const sending = compose.status === 'sending';
		return html`<section
			class=${`compose${this.dragging ? ' dragging' : ''}`}
			role="dialog"
			aria-label=${title}
			tabindex="-1"
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
			<div class="fields" ?inert=${sending}>
				${fromPicker(this.identities, draft, this.i18n, (change) => this.change(change))}
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
				${formatBar(this.i18n, (command, value) => this.format(command, value))}
				<div
					class="editor"
					contenteditable="true"
					role="textbox"
					aria-multiline="true"
					aria-label=${this.t('compose.body')}
					@input=${() => this.edited()}
					@paste=${(e: ClipboardEvent) => pasteClean(e, this.ownerDocument, this.pictures) && this.inserted()}
					@dragstart=${() => (this.moving = true)}
					@dragend=${() => (this.moving = false)}
				></div>
				${fileList(listedFiles(draft.attachments, this.pictures.shown), this.i18n, (blobId) => this.detach(blobId))}
			</div>
			${composeFooter(compose, this.readingFiles, this.i18n, this.footer)}
		</section>`;
	}
}

export function defineMailCompose(): void {
	defineOnce('mail-compose', MailCompose);
}
