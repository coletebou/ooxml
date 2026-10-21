// <mail-reading-pane>: the open conversation, oldest message first. The newest and the unread
// messages start expanded; a collapsed one shows its first line. Plain text is shown as text with
// links; HTML goes through <mail-html-frame>. Remote images stay blocked per message until the
// person chooses to show them. Every action is an event the app turns into a client call.
import { html, nothing, type PropertyValues } from 'lit';
import {
	DRAFT,
	FLAGGED,
	formatAddress,
	sameAddress,
	type MailAddress,
	type MailAttachment,
	type MailboxView,
	type MailMessage,
	type OpenConversationView,
	type OpenMessageView,
} from 'ooxml-core/mail';
import { attachmentStrip } from './attachments';
import { defineOnce, MailElement, mailStyles } from './base';
import { fullDate, hueOf, initials, names } from './format';
import { defineMailHtmlFrame } from './html-frame';
import { icon } from './icons';
import { conversationToolbar } from './reading-toolbar';
import { linkify } from './sanitize';
import css from './reading-pane.css?raw';

export type InlineUrls = (message: MailMessage) => Promise<ReadonlyMap<string, string>>;

/**
 * The pictures of a message that has none, or whose pictures are still being found: always this
 * one map, as a new empty one would have the frame clean and write its message again.
 */
const NO_PICTURES: ReadonlyMap<string, string> = new Map();

export class MailReadingPane extends MailElement {
	/** Focus the first action of the toolbar (Back on a narrow app), where reading starts. */
	override focus(options?: FocusOptions): void {
		this.renderRoot.querySelector<HTMLElement>('.toolbar button')?.focus(options);
	}

	static override styles = mailStyles(css);
	static override properties = {
		...MailElement.properties,
		conversation: { attribute: false },
		mailboxes: { attribute: false },
		me: { attribute: false },
		inlineUrls: { attribute: false },
		expanded: { state: true },
		allowed: { state: true },
		blocked: { state: true },
		inline: { state: true },
	};
	declare conversation: OpenConversationView | null;
	declare mailboxes: readonly MailboxView[];
	/** The person's own addresses, shown as "me". */
	declare me: readonly string[];
	declare inlineUrls: InlineUrls;
	declare expanded: ReadonlySet<string>;
	declare allowed: ReadonlySet<string>;
	declare blocked: ReadonlyMap<string, number>;
	declare inline: ReadonlyMap<string, ReadonlyMap<string, string>>;

	constructor() {
		super();
		this.conversation = null;
		this.mailboxes = [];
		this.me = [];
		this.inlineUrls = async () => new Map();
		this.expanded = new Set();
		this.allowed = new Set();
		this.blocked = new Map();
		this.inline = new Map();
	}

	override connectedCallback(): void {
		super.connectedCallback();
		defineMailHtmlFrame();
	}

	protected override willUpdate(changed: PropertyValues<this>): void {
		const previous = changed.get('conversation') as OpenConversationView | null | undefined;
		if (changed.has('conversation') && previous?.id !== this.conversation?.id) {
			const messages = this.conversation?.messages ?? [];
			this.expanded = new Set(
				messages
					.filter((m, i) => i === messages.length - 1 || !m.summary.keywords.$seen)
					.map((m) => m.summary.id),
			);
			this.allowed = new Set();
			this.blocked = new Map();
			this.inline = new Map();
		}
		// The pictures of each loaded message that shows some, looked up once per message. Started
		// here rather than once drawn, so the placeholder is part of this update, not another one.
		const opened = this.conversation?.id;
		for (const view of this.conversation?.messages ?? []) {
			const message = view.message;
			if (!message?.html || this.inline.has(message.id)) continue;
			if (!message.attachments.some((a) => a.cid)) continue;
			const id = message.id;
			this.inline = new Map(this.inline).set(id, NO_PICTURES);
			void this.inlineUrls(message).then((urls) => {
				// Dropped when another conversation opened meanwhile: they are not its pictures.
				if (this.conversation?.id === opened) this.inline = new Map(this.inline).set(id, urls);
			});
		}
	}

	private toggle(id: string): void {
		const next = new Set(this.expanded);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		this.expanded = next;
	}

	/** Whether an address is one of the person's own. */
	private isMe(address: MailAddress): boolean {
		return this.me.some((own) => sameAddress(own, address));
	}

	private person(address: MailAddress): string {
		return this.isMe(address) ? this.t('reading.me') : formatAddress(address);
	}

	private body(view: OpenMessageView) {
		const message = view.message;
		if (view.error) return html`<p class="error" role="alert">${this.t('reading.loadFailed')}</p>`;
		if (!message) return html`<p class="loading" role="status">${this.t('reading.loading')}</p>`;
		const id = message.id;
		const blocked = this.blocked.get(id) ?? 0;
		const banner =
			blocked && !this.allowed.has(id)
				? html`<p class="remote" role="note">
						${icon('mail-image')}<span>${this.tn('reading.remoteBlocked', blocked)}</span>
						<button type="button" @click=${() => (this.allowed = new Set([...this.allowed, id]))}
							>${this.t('reading.showImages')}</button
						>
					</p>`
				: nothing;
		const content = message.html
			? html`<mail-html-frame
					.html=${message.html}
					.htmlParts=${message.htmlParts ?? null}
					.allowRemote=${this.allowed.has(id)}
					.cidUrls=${this.inline.get(id) ?? NO_PICTURES}
					.label=${this.t('reading.bodyLabel', { subject: message.subject })}
					@mail-remote-blocked=${(e: CustomEvent<{ count: number }>) => {
						e.stopPropagation();
						// None stored reads as none blocked: a message that blocks nothing needs no update.
						if ((this.blocked.get(id) ?? 0) !== e.detail.count)
							this.blocked = new Map(this.blocked).set(id, e.detail.count);
					}}
				></mail-html-frame>`
			: html`<div class="text"
					>${linkify(message.text ?? '').map((part) =>
						part.href
							? html`<a
									href=${part.href}
									target="_blank"
									rel="noopener noreferrer"
									@click=${(e: Event) => {
										if (!part.href!.startsWith('mailto:')) return;
										e.preventDefault();
										this.emit('mail-mailto', { href: part.href });
									}}
									>${part.text}</a
								>`
							: part.text,
					)}</div
				>`;
		return html`${banner}${content}${attachmentStrip(message, this.i18n, {
			preview: (attachment: MailAttachment) =>
				this.emit('mail-attachment', { action: 'preview', attachment, emailId: id }),
			download: (attachment: MailAttachment) =>
				this.emit('mail-attachment', { action: 'download', attachment, emailId: id }),
		})}`;
	}

	private message(view: OpenMessageView) {
		const summary = view.summary;
		const from = summary.from[0];
		const open = this.expanded.has(summary.id);
		const recipients = [...summary.to, ...summary.cc];
		const to = recipients.length
			? this.t('reading.to', {
					names: names(
						recipients.map((a) =>
							this.isMe(a) ? { name: this.t('reading.me'), email: a.email } : a,
						),
						this.i18n,
					),
				})
			: '';
		const draft = summary.keywords[DRAFT] === true;
		return html`<article
			class=${`message${open ? ' open' : ''}${summary.keywords.$seen ? '' : ' unread'}`}
			style=${`--depth:${Math.min(view.depth, 6)}`}
		>
			<header>
				<button
					type="button"
					class="summary"
					aria-expanded=${open ? 'true' : 'false'}
					@click=${() => this.toggle(summary.id)}
				>
					<span class="avatar" style=${`--hue:${hueOf(from?.email ?? '')}`} aria-hidden="true"
						>${initials(from)}</span
					>
					<span class="who">
						<strong>${from ? this.person(from) : this.t('list.noSender')}</strong>
						<span class="to">${to}</span>
					</span>
					<time>${fullDate(summary.sentAt ?? summary.receivedAt, this.i18n)}</time>
				</button>
				${summary.keywords[FLAGGED] ? html`<span class="flagged" title=${this.t('reading.flagged')}>${icon('mail-flag')}</span>` : nothing}
				<span class="tools">
					${
						draft
							? html`<button
									type="button"
									@click=${() => this.emit('mail-edit-draft', { emailId: summary.id })}
									>${icon('pencil')}<span>${this.t('reading.editDraft')}</span></button
								>`
							: html`<button
										type="button"
										aria-label=${this.t('reading.reply')}
										title=${this.t('reading.reply')}
										@click=${() => this.emit('mail-reply', { emailId: summary.id, mode: 'reply' })}
										>${icon('mail-reply')}</button
									>
									<button
										type="button"
										aria-label=${this.t('reading.replyAll')}
										title=${this.t('reading.replyAll')}
										@click=${() => this.emit('mail-reply', { emailId: summary.id, mode: 'replyAll' })}
										>${icon('mail-reply-all')}</button
									>
									<button
										type="button"
										aria-label=${this.t('reading.forward')}
										title=${this.t('reading.forward')}
										@click=${() => this.emit('mail-reply', { emailId: summary.id, mode: 'forward' })}
										>${icon('mail-forward')}</button
									>`
					}
					<button
						type="button"
						aria-label=${this.t('reading.exportEml')}
						title=${this.t('reading.exportEml')}
						@click=${() => this.emit('mail-export', { emailId: summary.id })}
						>${icon('mail-download')}</button
					>
				</span>
			</header>
			${
				open
					? html`<div class="details"
								>${from ? html`<span>${this.t('reading.fromLine', { address: formatAddress(from) })}</span>` : nothing}${summary.cc.length ? html`<span>${this.t('reading.ccLine', { names: summary.cc.map(formatAddress).join(', ') })}</span>` : nothing}</div
							>
							<div class="body">${this.body(view)}</div>`
					: html`<p class="snippet" @click=${() => this.toggle(summary.id)}>${summary.preview}</p>`
			}
		</article>`;
	}

	private toolbar(conversation: OpenConversationView) {
		const id = conversation.id;
		return conversationToolbar(conversation, this.mailboxes, this.i18n, {
			act: (action) => this.emit('mail-action', { action, id }),
			move: (mailboxId) => this.emit('mail-move', { mailboxId, ids: [id] }),
		});
	}

	protected override render() {
		const conversation = this.conversation;
		if (!conversation)
			return html`<div class="placeholder"
				>${icon('mail-envelope')}<p>${this.t('reading.nothingOpen')}</p></div
			>`;
		return html`${this.toolbar(conversation)}
			<h2>${conversation.subject || this.t('list.noSubject')}</h2>
			<div class="thread">${conversation.messages.map((view) => this.message(view))}</div>`;
	}
}

export function defineMailReadingPane(): void {
	defineOnce('mail-reading-pane', MailReadingPane);
}
