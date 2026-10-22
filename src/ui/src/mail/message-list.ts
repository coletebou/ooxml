// <mail-message-list>: the conversation list. It is virtualised: a spacer as tall as every row and
// only the rows in view (plus a margin) in the DOM, so thousands of conversations scroll as fast as
// thirty. Click opens, Ctrl/Cmd+click toggles, Shift+click extends the selection; rows drag onto a
// folder to move. Keyboard shortcuts are the app's (see keyboard.ts).
import { html, nothing, type PropertyValues } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import type { ConversationView } from 'ooxml-core/mail';
import { defineOnce, MailElement, mailStyles } from './base';
import { MAIL_DRAG_TYPE } from './folder-pane';
import { listDate, names } from './format';
import { icon } from './icons';
import css from './message-list.css?raw';

const OVERSCAN = 8;
const FALLBACK_ROW = 72;

export class MailMessageList extends MailElement {
	static override styles = mailStyles(css);
	static override properties = {
		...MailElement.properties,
		conversations: { attribute: false },
		selection: { attribute: false },
		focused: { type: String },
		openId: { type: String, attribute: 'open-id' },
		loading: { type: Boolean },
		total: { type: Number },
		loaded: { type: Number },
		/** Show recipients instead of senders (Sent, Drafts). */
		recipients: { type: Boolean },
		searching: { type: Boolean },
		top: { state: true },
		height: { state: true },
	};
	declare conversations: readonly ConversationView[];
	declare selection: readonly string[];
	declare focused: string;
	declare openId: string;
	declare loading: boolean;
	declare total: number;
	declare loaded: number;
	declare recipients: boolean;
	declare searching: boolean;
	declare top: number;
	declare height: number;
	private rowHeight = 0;
	private observer: ResizeObserver | undefined;

	constructor() {
		super();
		this.conversations = [];
		this.selection = [];
		this.focused = '';
		this.openId = '';
		this.loading = false;
		this.total = 0;
		this.loaded = 0;
		this.recipients = false;
		this.searching = false;
		this.top = 0;
		this.height = 0;
	}

	private get viewport(): HTMLElement | null {
		return this.renderRoot.querySelector<HTMLElement>('.viewport');
	}

	/** Focus the list itself (the listbox), where the arrows and the shortcuts work. */
	override focus(options?: FocusOptions): void {
		this.viewport?.focus(options);
	}

	override connectedCallback(): void {
		super.connectedCallback();
		// Connected again after a move in the page (an app moves with its panes): its viewport, drawn
		// before, is followed again, at the size it has where it is now.
		if (this.hasUpdated) this.follow();
	}

	override disconnectedCallback(): void {
		this.observer?.disconnect();
		super.disconnectedCallback();
	}

	protected override firstUpdated(): void {
		this.follow();
	}

	/** Follow the height of the viewport, which sets how many rows are drawn. */
	private follow(): void {
		const viewport = this.viewport;
		if (!viewport) return;
		if (typeof ResizeObserver !== 'undefined') {
			this.observer ??= new ResizeObserver(() => {
				this.height = this.viewport?.clientHeight ?? 0;
			});
			this.observer.observe(viewport);
		}
		this.height = viewport.clientHeight;
	}

	protected override updated(changed: PropertyValues<this>): void {
		const row = this.renderRoot.querySelector<HTMLElement>('.row');
		const measured = row?.getBoundingClientRect().height ?? 0;
		if (measured > 0 && Math.abs(measured - this.rowHeight) > 0.5) {
			this.rowHeight = measured;
			this.requestUpdate();
		}
		if (changed.has('focused') && this.focused) this.reveal(this.focused);
	}

	/** Scroll so the row of `id` is in view. */
	reveal(id: string): void {
		const viewport = this.viewport;
		const index = this.conversations.findIndex((c) => c.id === id);
		if (!viewport || index < 0) return;
		const size = this.rowHeight || FALLBACK_ROW;
		const top = index * size;
		if (top < viewport.scrollTop) viewport.scrollTop = top;
		else if (top + size > viewport.scrollTop + viewport.clientHeight)
			viewport.scrollTop = top + size - viewport.clientHeight;
	}

	private rowClick(event: MouseEvent, conversation: ConversationView): void {
		if (event.shiftKey) this.emit('mail-select-range', { id: conversation.id });
		else if (event.ctrlKey || event.metaKey)
			this.emit('mail-toggle-select', { id: conversation.id });
		else this.emit('mail-open', { id: conversation.id });
	}

	private dragStart(event: DragEvent, conversation: ConversationView): void {
		const ids = this.selection.includes(conversation.id) ? this.selection : [conversation.id];
		event.dataTransfer?.setData(MAIL_DRAG_TYPE, JSON.stringify(ids));
		event.dataTransfer?.setData('text/plain', conversation.subject);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}

	private row(conversation: ConversationView, index: number, size: number) {
		const selected = this.selection.includes(conversation.id);
		const people = this.recipients ? conversation.recipients : conversation.participants;
		const who = people.length ? names(people, this.i18n) : this.t('list.noSender');
		const subject = conversation.subject || this.t('list.noSubject');
		const classes = [
			'row',
			conversation.unread ? 'unread' : '',
			selected ? 'selected' : '',
			conversation.id === this.openId ? 'open' : '',
			conversation.id === this.focused ? 'focused' : '',
		].join(' ');
		return html`<div
			class=${classes}
			role="option"
			id=${`row-${index}`}
			aria-selected=${selected || conversation.id === this.openId ? 'true' : 'false'}
			aria-posinset=${index + 1}
			aria-setsize=${this.conversations.length}
			style=${`transform:translateY(${index * size}px)`}
			draggable="true"
			@dragstart=${(e: DragEvent) => this.dragStart(e, conversation)}
			@click=${(e: MouseEvent) => this.rowClick(e, conversation)}
		>
			<input
				type="checkbox"
				.checked=${selected}
				aria-label=${this.t('list.select', { subject })}
				@click=${(e: MouseEvent) => {
					e.stopPropagation();
					// Shift and a click select a range here too, as on the row.
					if (e.shiftKey) this.emit('mail-select-range', { id: conversation.id });
					else this.emit('mail-toggle-select', { id: conversation.id });
				}}
			/>
			<span class="who" title=${who}
				>${this.recipients ? html`<span class="to">${this.t('list.to')}</span> ` : nothing}${who}</span
			>
			${conversation.count > 1 ? html`<span class="count" aria-label=${this.tn('list.messages', conversation.count)}>${conversation.count}</span>` : nothing}
			<span class="meta">
				${conversation.hasAttachment ? html`<span title=${this.t('list.hasAttachment')}>${icon('mail-attach')}</span>` : nothing}
				${conversation.draft ? html`<span class="draft">${this.t('list.draft')}</span>` : nothing}
				<time>${listDate(conversation.date, this.i18n)}</time>
			</span>
			<span class="subject">${subject}</span>
			<button
				type="button"
				class=${`flag${conversation.flagged ? ' on' : ''}`}
				aria-pressed=${conversation.flagged ? 'true' : 'false'}
				aria-label=${this.t(conversation.flagged ? 'list.unflag' : 'list.flag')}
				@click=${(e: Event) => {
					e.stopPropagation();
					this.emit('mail-flag', { id: conversation.id, flagged: !conversation.flagged });
				}}
			>
				${icon('mail-flag')}
			</button>
			<span class="preview">${conversation.preview}</span>
		</div>`;
	}

	private empty() {
		if (this.loading) return html`<p class="empty" role="status">${this.t('list.loading')}</p>`;
		return html`<p class="empty">${this.t(this.searching ? 'list.noResults' : 'list.empty')}</p>`;
	}

	protected override render() {
		const size = this.rowHeight || FALLBACK_ROW;
		const count = this.conversations.length;
		const first = Math.max(0, Math.floor(this.top / size) - OVERSCAN);
		const last = Math.min(
			count,
			Math.ceil((this.top + (this.height || size * 20)) / size) + OVERSCAN,
		);
		const visible = this.conversations.slice(first, last);
		const focusedIndex = this.conversations.findIndex((c) => c.id === this.focused);
		return html`<div
			class="viewport"
			role="listbox"
			tabindex="0"
			aria-label=${this.t('list.label')}
			aria-multiselectable="true"
			aria-busy=${this.loading ? 'true' : 'false'}
			aria-activedescendant=${focusedIndex >= first && focusedIndex < last ? `row-${focusedIndex}` : nothing}
			@scroll=${(e: Event) => (this.top = (e.currentTarget as HTMLElement).scrollTop)}
		>
			${count ? nothing : this.empty()}
			<div class="spacer" style=${`height:${count * size}px`}>
				${repeat(
					visible,
					(c) => c.id,
					(c, i) => this.row(c, first + i, size),
				)}
			</div>
			${
				this.loaded < this.total
					? html`<div class="more">
							<span>${this.t('list.showing', { loaded: this.loaded, total: this.total })}</span>
							<button type="button" @click=${() => this.emit('mail-load-more', {})}
								>${this.t('list.loadMore')}</button
							>
						</div>`
					: nothing
			}
		</div>`;
	}
}

export function defineMailMessageList(): void {
	defineOnce('mail-message-list', MailMessageList);
}
