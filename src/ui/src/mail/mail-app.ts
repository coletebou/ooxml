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
import { committingClient, release } from './app-client';
import { runCommand } from './app-commands';
import { composeView } from './app-compose-view';
import { mailView } from './app-mail-view';
import { calendarView, contactsView } from './app-people-view';
import { errorText, noticeText, quoteFormat } from './app-text';
import { defineMailAttachmentPreview } from './attachment-preview';
import { defineMailCalendar } from './calendar-pane';
import { defineMailCompose, type MailCompose } from './compose';
import { defineMailContacts } from './contacts-pane';
import { defineOnce, MailElement, mailStyles } from './base';
import { FocusKeeper } from './focus-keeper';
import { defineMailFolderPane } from './folder-pane';
import { icon } from './icons';
import { InlineImages } from './inline-images';
import { commandFor, controlOwnsKey, isTyping } from './keyboard';
import { mailtoDraft } from './mailto';
import { defineMailMessageList } from './message-list';
import { FocusReturn, focusFirst } from './modal';
import { downloadBytes } from './object-urls';
import { defineMailReadingPane, type MailReadingPane } from './reading-pane';
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
	/** The pictures message bodies show in place, made for the running client. */
	private images: InlineImages | null = null;
	/** What had the focus before the shortcuts dialog opened. */
	private readonly dialogFocus = new FocusReturn();
	/** Keeps the focus in the app when an update takes away what had it. */
	private readonly focusKeeper = new FocusKeeper(this);
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

	/**
	 * The core client behind this element, for hosts that want the raw actions: there from the
	 * element's first update in the page (`await el.updateComplete`) until it leaves the page (moved
	 * within it, it keeps the same one).
	 */
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
		// The client starts with the next update (`willUpdate`), once the host has set what it sets
		// along with connecting the element: a framework that defines or adds it, then sets `config`,
		// gets that connection and never the demo mailbox first. Back in a page it left, it starts
		// again; moved within one, it still has its client.
		if (!this.mail) this.requestUpdate();
	}

	override disconnectedCallback(): void {
		this.removeEventListener('keydown', this.onKey);
		// A move takes the element out and puts it back in one go: the client goes only if the
		// element is still out of the page once that is done. Let go on a move, it would close the
		// transport the host gave it, which the element then starts with again.
		queueMicrotask(() => {
			if (!this.isConnected) this.stop();
		});
		super.disconnectedCallback();
	}

	protected override willUpdate(changed: PropertyValues<this>): void {
		// An update in the page starts the client with the connection set by then; out of the page,
		// none starts. `config` is compared by value, so a host that writes an equal connection again
		// (an inline object on every render) keeps its client; only a different mailbox reconnects.
		if (!this.mail) {
			if (this.isConnected) this.start();
		} else if (changed.has('config') && !sameMailConnection(this.config, this.startedWith)) {
			this.stop();
			if (this.isConnected) this.start();
		}
		if (changed.has('theme')) {
			if (this.theme === 'light' || this.theme === 'dark')
				this.setAttribute('data-office-theme', this.theme);
			else this.removeAttribute('data-office-theme');
		}
		if (changed.has('dialog') && this.dialog && !changed.get('dialog'))
			this.dialogFocus.take(this.ownerDocument);
		const before = changed.get('state') as MailState | null | undefined;
		this.focusKeeper.note(changed.has('state') && !before?.compose && !!this.state?.compose);
	}

	protected override updated(changed: PropertyValues<this>): void {
		this.focusKeeper.keep(this.state);
		// The shortcuts dialog is modal: the focus moves in, and back to what had it once it closes.
		if (!changed.has('dialog')) return;
		if (this.dialog && !changed.get('dialog'))
			focusFirst(this.renderRoot.querySelector('[aria-modal="true"]'));
		else if (!this.dialog && changed.get('dialog')) this.dialogFocus.restore();
	}

	private start(): void {
		this.startedWith = this.config;
		const client = createMail({
			...(this.config ? { config: this.config } : {}),
			quoteFormat: quoteFormat(() => this.i18n),
		});
		// Only while the window shows this client's draft: once released, a client trying again to
		// save in the background must not take what is being typed for the next one.
		const mail = committingClient(client, () =>
			this.mail === mail ? this.renderRoot.querySelector<MailCompose>('mail-compose') : null,
		);
		this.mail = mail;
		this.images = new InlineImages(
			(part) => mail.download(part).catch(() => null),
			() => new Set(client.getState().open?.messages.map((view) => view.summary.id)),
		);
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
		// Released while still current, so its first try takes what the window holds (the files it is
		// still reading, then the addresses being typed); any later tries run in the background until
		// the draft is saved, and a new connection or remount never waits for them.
		if (this.mail) void release(this.mail);
		this.mail = null;
		// What the client showed goes with it: its pictures, the attachment opened from it, and its
		// notices (their Undo would act on the mailbox just left).
		this.images?.clear();
		this.images = null;
		this.preview = null;
		this.toasts = [];
	}

	/** Show a notice as a toast (and as a `mail-notice` event for the host). */
	notify(notice: MailNotice): void {
		this.emit('mail-notice', notice);
		const id = ++this.toastId;
		const undo = notice.kind === 'done' ? notice.undo : undefined;
		this.toasts = [
			...this.toasts.slice(-2),
			{ id, text: noticeText(notice, this.i18n), tone: notice.kind, ...(undo ? { undo } : {}) },
		];
		setTimeout(() => this.dismissToast(id), TOAST_MS);
	}

	private dismissToast(id: number): void {
		this.toasts = this.toasts.filter((toast) => toast.id !== id);
	}

	private keydown(event: KeyboardEvent): void {
		if (event.defaultPrevented) return;
		const path = event.composedPath();
		const command = commandFor(event, isTyping(path));
		if (!command || !this.mail || controlOwnsKey(event, path)) return;
		if (runCommand(this, this.mail, command)) event.preventDefault();
	}

	/** The translator of this element, for the view modules. */
	i18nFor() {
		return this.i18n;
	}

	/**
	 * After the person opened a conversation from the list: on a narrow app the list hides, which
	 * would drop the focus out of the app (and its shortcuts), so it follows into the reading pane.
	 */
	followOpened(): void {
		void this.updateComplete.then(async () => {
			const list = this.renderRoot.querySelector<HTMLElement>('.list-pane');
			if (list?.checkVisibility?.() !== false) return;
			const pane = this.renderRoot.querySelector<MailReadingPane>('mail-reading-pane');
			await pane?.updateComplete;
			pane?.focus();
		});
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
		else if (state?.compose) this.closeCompose();
		else if (this.foldersOpen) this.foldersOpen = false;
		else if (state?.open) this.mail?.close();
		else if (state?.selection.length) this.mail?.clearSelection();
		else return false;
		return true;
	}

	/** Close the compose window as its own Close does, so the files it is still reading go in. */
	private closeCompose(): void {
		const compose = this.renderRoot.querySelector<MailCompose>('mail-compose');
		if (compose) compose.close();
		else void this.mail?.closeCompose();
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
		const draft = mailtoDraft(href);
		if (!mail || !draft) return;
		// False: the open draft could not be saved, so it stays open and must keep its fields.
		if (!(await mail.compose('new'))) return;
		mail.updateDraft(draft);
	}

	/** The URLs of the pictures a message's HTML body shows in place, by `cid` (lower case). */
	inlineUrls(message: MailMessage): Promise<ReadonlyMap<string, string>> {
		return this.images?.urls(message) ?? Promise.resolve(new Map());
	}

	/** Open an attachment: the host may take over (cancel `mail-open-attachment`), else preview it. */
	async openAttachment(emailId: string, attachment: MailAttachment): Promise<void> {
		const mail = this.mail;
		const bytes = await mail?.download(attachment).catch(() => null);
		// A file of a mailbox the app has left since is not opened over the next one.
		if (!bytes || this.mail !== mail) return;
		const detail: OpenAttachmentDetail = { emailId, attachment, bytes };
		if (this.emit('mail-open-attachment', detail, true)) this.preview = detail;
	}

	private rail() {
		const unread = this.state?.mailboxes.find((m) => m.role === 'inbox')?.unreadEmails ?? 0;
		// Named by aria-label too: a narrow layout hides the labels and the icons are not announced.
		const item = (view: MailView, glyph: string, label: string, badge = 0) =>
			html`<button
				type="button"
				class="rail-item"
				aria-label=${label}
				aria-current=${this.view === view ? 'page' : 'false'}
				@click=${() => (this.view = view)}
				>${icon(glyph)}<span>${label}</span>${badge ? html`<span class="badge" aria-hidden="true">${badge > 99 ? '99+' : badge}</span>` : nothing}</button
			>`;
		return html`<nav class="rail" aria-label=${this.t('app.navigation')}>
			${item('mail', 'mail-envelope', this.t('app.mail'), unread)}
			${item('calendar', 'mail-calendar', this.t('app.calendar'))}
			${item('contacts', 'mail-contacts', this.t('app.contacts'))}
			<span class="rail-spacer"></span>
			<button
				type="button"
				class="rail-item"
				aria-label=${this.t('app.shortcuts')}
				@click=${() => (this.dialog = 'shortcuts')}
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
											this.dismissToast(toast.id);
										}}
										>${this.t('notice.undo')}</button
									>`
								: nothing
						}
						<button
							type="button"
							class="dismiss"
							aria-label=${this.t('notice.dismiss')}
							@click=${() => this.dismissToast(toast.id)}
							>${icon('close')}</button
						>
					</div>`,
			)}
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
			${mail && state ? composeView(mail, state) : nothing}
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
