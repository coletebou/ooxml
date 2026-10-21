// <mail-app>: mail, calendar and contacts in one element. All mail logic lives in
// `createMailClient` (ooxml-core/mail); this element decides what is on screen and forwards what a
// person does to client actions. It runs on the demo mailbox (in memory) unless given a JMAP
// server or a transport of its own.
import { html, nothing, unsafeCSS, type PropertyValues } from 'lit';
import type {
	MailAttachment,
	MailClient,
	MailMessage,
	MailNotice,
	MailState,
} from 'ooxml-core/mail';
import { THEME_CSS, installOfficeUiTheme } from '../theme';
import { runCommand } from './app-commands';
import { downloadBytes, mailView } from './app-mail-view';
import { calendarView, contactsView } from './app-people-view';
import { errorText, noticeText, quoteFormat } from './app-text';
import { defineMailAttachmentPreview } from './attachment-preview';
import { defineMailCalendar } from './calendar-pane';
import { defineMailCompose } from './compose';
import { defineMailContacts } from './contacts-pane';
import { defineOnce, MailElement, mailStyles } from './base';
import { defineMailFolderPane } from './folder-pane';
import { icon } from './icons';
import { commandFor, isTyping } from './keyboard';
import { defineMailMessageList } from './message-list';
import { defineMailReadingPane } from './reading-pane';
import { shortcutsDialog } from './shortcuts-dialog';
import { createMail, sameMailConnection, type MailConnection } from './store';
import css from './mail-app.css?raw';

export type MailView = 'mail' | 'calendar' | 'contacts';
export type MailTheme = 'system' | 'light' | 'dark';

/** The detail of `mail-open-attachment`; cancel the event to open the file yourself. */
export interface OpenAttachmentDetail {
	emailId: string;
	attachment: MailAttachment;
	bytes: Uint8Array;
}

interface Toast {
	id: number;
	text: string;
	tone: 'done' | 'error' | 'warning';
	undo?: () => Promise<void>;
}

// The theme's tokens scoped to the element, so it themes itself without a page stylesheet and
// `data-office-theme` on the host switches light and dark (the Teams element does the same).
const LOCAL_THEME = THEME_CSS.replaceAll(
	':root[data-office-theme="dark"]',
	':host([data-office-theme="dark"])',
)
	.replaceAll(':root:not([data-office-theme="light"])', ':host(:not([data-office-theme="light"]))')
	.replaceAll(':root', ':host');

const TOAST_MS = 6000;

export class MailApp extends MailElement {
	static override styles = [unsafeCSS(LOCAL_THEME), ...mailStyles(css)];
	static override properties = {
		...MailElement.properties,
		config: { attribute: false },
		theme: { type: String, reflect: false },
		view: { type: String },
		state: { state: true },
		toasts: { state: true },
		foldersOpen: { state: true },
		dialog: { state: true },
		preview: { state: true },
	};
	/** Where the mail comes from. Omitted means the demo mailbox. */
	declare config: MailConnection | null;
	declare theme: MailTheme;
	declare view: MailView;
	declare state: MailState | null;
	declare toasts: readonly Toast[];
	/** Narrow screens: the folder pane is a drawer. */
	declare foldersOpen: boolean;
	declare dialog: '' | 'shortcuts' | 'account';
	declare preview: OpenAttachmentDetail | null;
	private mail: MailClient | null = null;
	/** The connection the running client was started with. */
	private startedWith: MailConnection | null = null;
	private stops: (() => void)[] = [];
	private toastId = 0;
	private readonly onKey = (event: KeyboardEvent): void => this.keydown(event);

	constructor() {
		super();
		this.config = null;
		this.theme = 'system';
		this.view = 'mail';
		this.state = null;
		this.toasts = [];
		this.foldersOpen = false;
		this.dialog = '';
		this.preview = null;
	}

	/** The core client behind this element, for hosts that want the raw actions. */
	get client(): MailClient | null {
		return this.mail;
	}

	override connectedCallback(): void {
		installOfficeUiTheme();
		defineMailFolderPane();
		defineMailMessageList();
		defineMailReadingPane();
		defineMailCompose();
		defineMailAttachmentPreview();
		defineMailCalendar();
		defineMailContacts();
		super.connectedCallback();
		this.addEventListener('keydown', this.onKey);
		if (!this.mail) this.start();
	}

	override disconnectedCallback(): void {
		this.removeEventListener('keydown', this.onKey);
		this.stop();
		super.disconnectedCallback();
	}

	protected override willUpdate(changed: PropertyValues<this>): void {
		// Compared by value, so a host that writes an equal connection again (an inline object on
		// every render) keeps its client; only a different mailbox reconnects.
		if (changed.has('config') && this.mail && !sameMailConnection(this.config, this.startedWith)) {
			this.stop();
			this.start();
		}
		if (changed.has('theme')) {
			if (this.theme === 'light' || this.theme === 'dark')
				this.setAttribute('data-office-theme', this.theme);
			else this.removeAttribute('data-office-theme');
		}
	}

	private start(): void {
		this.startedWith = this.config;
		const client = createMail({
			...(this.config ? { config: this.config } : {}),
			quoteFormat: quoteFormat(() => this.i18n),
		});
		this.mail = client;
		this.state = client.getState();
		let ready = false;
		this.stops = [
			client.subscribe(() => {
				this.state = client.getState();
				if (!ready && this.state.status === 'ready') {
					ready = true;
					this.emit('mail-ready', { account: this.state.account });
				}
			}),
			client.onNotice((notice) => this.notify(notice)),
		];
	}

	private stop(): void {
		for (const stop of this.stops) stop();
		this.stops = [];
		void this.mail?.closeCompose();
		this.mail?.destroy();
		this.mail = null;
		for (const url of this.objectUrls) URL.revokeObjectURL(url);
		this.objectUrls = [];
		this.inline.clear();
	}

	/** Show a notice as a toast (and as a `mail-notice` event for the host). */
	notify(notice: MailNotice): void {
		this.emit('mail-notice', notice);
		const id = ++this.toastId;
		const tone = notice.kind === 'done' ? 'done' : notice.kind;
		const undo = notice.kind === 'done' ? notice.undo : undefined;
		this.toasts = [
			...this.toasts.slice(-2),
			{ id, text: noticeText(notice, this.i18n), tone, ...(undo ? { undo } : {}) },
		];
		setTimeout(() => (this.toasts = this.toasts.filter((toast) => toast.id !== id)), TOAST_MS);
	}

	private keydown(event: KeyboardEvent): void {
		if (event.defaultPrevented) return;
		const command = commandFor(event, isTyping(event.composedPath()));
		if (!command || !this.mail) return;
		if (runCommand(this, this.mail, command)) event.preventDefault();
	}

	/** The translator of this element, for the view modules. */
	i18nFor() {
		return this.i18n;
	}

	focusSearch(): boolean {
		if (this.view !== 'mail') return false;
		this.renderRoot.querySelector<HTMLInputElement>('.search input')?.focus();
		return true;
	}

	/** Escape: close the topmost thing (dialog, preview, compose, open message, selection). */
	closeTopmost(): boolean {
		const state = this.mail?.getState();
		if (this.dialog) this.dialog = '';
		else if (this.preview) this.preview = null;
		else if (state?.compose) void this.mail?.closeCompose();
		else if (this.foldersOpen) this.foldersOpen = false;
		else if (state?.open) this.mail?.close();
		else if (state?.selection.length) this.mail?.clearSelection();
		else return false;
		return true;
	}

	/** A toolbar action of the reading pane on conversation `id`. */
	readingAction(action: string, id: string): void {
		const mail = this.mail;
		if (!mail) return;
		if (action === 'close') mail.close();
		else if (action === 'unread') {
			void mail.markRead(false, [id]);
			mail.close();
		} else if (action === 'flag') void mail.toggleFlagged([id]);
		else if (action === 'archive' || action === 'delete' || action === 'junk') {
			mail.select([]);
			runCommand(this, mail, action);
		}
	}

	/** A `mailto:` link: a new message to its address, subject and body (RFC 6068). */
	async mailto(href: string): Promise<void> {
		const mail = this.mail;
		if (!mail) return;
		let url: URL;
		try {
			url = new URL(href);
		} catch {
			return;
		}
		const to = decodeURIComponent(url.pathname)
			.split(',')
			.map((email) => email.trim())
			.filter(Boolean)
			.map((email) => ({ name: '', email }));
		await mail.compose('new');
		mail.updateDraft({
			to,
			subject: url.searchParams.get('subject') ?? '',
			text: url.searchParams.get('body') ?? '',
		});
	}

	private inline = new Map<string, Promise<ReadonlyMap<string, string>>>();
	private objectUrls: string[] = [];

	/** Object URLs of a message's inline (`cid:`) images, made once per message. */
	inlineUrls(message: MailMessage): Promise<ReadonlyMap<string, string>> {
		const known = this.inline.get(message.id);
		if (known) return known;
		const made = (async () => {
			const urls = new Map<string, string>();
			for (const attachment of message.attachments) {
				if (!attachment.cid || !attachment.type.startsWith('image/')) continue;
				const bytes = await this.mail?.download(attachment).catch(() => null);
				if (!bytes) continue;
				const url = URL.createObjectURL(
					new Blob([new Uint8Array(bytes)], { type: attachment.type }),
				);
				this.objectUrls.push(url);
				urls.set(attachment.cid.toLowerCase(), url);
			}
			return urls;
		})();
		this.inline.set(message.id, made);
		return made;
	}

	/** Open an attachment: the host may take over (cancel `mail-open-attachment`), else preview it. */
	async openAttachment(emailId: string, attachment: MailAttachment): Promise<void> {
		const bytes = await this.mail?.download(attachment).catch(() => null);
		if (!bytes) return;
		const detail: OpenAttachmentDetail = { emailId, attachment, bytes };
		if (this.emit('mail-open-attachment', detail, true)) this.preview = detail;
	}

	private rail() {
		const unread = this.state?.mailboxes.find((m) => m.role === 'inbox')?.unreadEmails ?? 0;
		const item = (view: MailView, glyph: string, label: string, badge = 0) =>
			html`<button
				type="button"
				class="rail-item"
				aria-current=${this.view === view ? 'page' : 'false'}
				@click=${() => (this.view = view)}
				>${icon(glyph)}<span>${label}</span>${badge ? html`<span class="badge" aria-hidden="true">${badge > 99 ? '99+' : badge}</span>` : nothing}</button
			>`;
		return html`<nav class="rail" aria-label=${this.t('app.navigation')}>
			${item('mail', 'mail-envelope', this.t('app.mail'), unread)}
			${item('calendar', 'mail-calendar', this.t('app.calendar'))}
			${item('contacts', 'mail-contacts', this.t('app.contacts'))}
			<span class="rail-spacer"></span>
			<button type="button" class="rail-item" @click=${() => (this.dialog = 'shortcuts')}
				>${icon('mail-keyboard')}<span>${this.t('app.shortcuts')}</span></button
			>
		</nav>`;
	}

	private toastsView() {
		return html`<div class="toasts" role="status" aria-live="polite">
			${this.toasts.map(
				(toast) =>
					html`<div class=${`toast ${toast.tone}`}>
						<span>${toast.text}</span>
						${
							toast.undo
								? html`<button
										type="button"
										@click=${() => {
											void toast.undo!();
											this.toasts = this.toasts.filter((t) => t.id !== toast.id);
										}}
										>${this.t('notice.undo')}</button
									>`
								: nothing
						}
						<button
							type="button"
							class="dismiss"
							aria-label=${this.t('notice.dismiss')}
							@click=${() => (this.toasts = this.toasts.filter((t) => t.id !== toast.id))}
							>${icon('close')}</button
						>
					</div>`,
			)}
		</div>`;
	}

	private composeView(mail: MailClient, state: MailState) {
		if (!state.compose) return nothing;
		return html`<div class="compose-layer">
			<mail-compose
				.compose=${state.compose}
				.identities=${state.identities}
				.contacts=${state.contacts}
				@mail-draft-change=${(e: CustomEvent<{ patch: Parameters<MailClient['updateDraft']>[0] }>) => mail.updateDraft(e.detail.patch)}
				@mail-draft-attach=${(e: CustomEvent<{ files: Parameters<MailClient['attach']>[0] }>) => void mail.attach(e.detail.files)}
				@mail-draft-detach=${(e: CustomEvent<{ blobId: string }>) => mail.detach(e.detail.blobId)}
				@mail-draft-send=${() => void mail.send()}
				@mail-draft-discard=${() => void mail.discardDraft()}
				@mail-draft-close=${() => void mail.closeCompose()}
			></mail-compose>
		</div>`;
	}

	protected override render() {
		const state = this.state;
		const mail = this.mail;
		return html`<div class="shell">
			${this.rail()}
			<main class="main">
				${state?.status === 'error' && state.error ? html`<p class="banner error" role="alert">${this.t('app.connectFailed', { reason: errorText(state.error, this.i18n) })}</p>` : nothing}
				${mail && state ? this.page(mail, state) : nothing}
			</main>
			${mail && state ? this.composeView(mail, state) : nothing}
			${
				this.preview
					? html`<mail-attachment-preview
							.detail=${this.preview}
							@mail-preview-close=${() => (this.preview = null)}
							@mail-preview-download=${(e: CustomEvent<OpenAttachmentDetail>) => downloadBytes(this.ownerDocument, e.detail.bytes, e.detail.attachment.name, e.detail.attachment.type)}
						></mail-attachment-preview>`
					: nothing
			}
			${this.dialog === 'shortcuts' ? shortcutsDialog(this.i18n, () => (this.dialog = '')) : nothing}
			${this.toastsView()}
		</div>`;
	}

	/** The open view: Mail, Calendar or Contacts. */
	private page(mail: MailClient, state: MailState) {
		if (this.view === 'mail') return mailView(this, mail, state);
		if (this.view === 'calendar') return calendarView(this, mail, state);
		return contactsView(this, mail, state);
	}
}

export function defineMailApp(): void {
	defineOnce('mail-app', MailApp);
}
