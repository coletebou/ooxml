import { html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { repeat } from 'lit/directives/repeat.js';
import { OfficeElement, controlStyles, flag } from '../base';
import { definer, present } from '../registry';
import css from './comments-pane.css?raw';
import { MentionTypeahead } from './mention-typeahead';
import {
	commentSegments,
	normalizeLineBreaks,
	sameMentions,
	trimMentionText,
	type OfficeCommentMention,
	type OfficeMentionCandidate,
} from './mentions';
import {
	DEFAULT_COMMENTS_LABELS,
	commentInitials,
	formatCommentTime,
	type OfficeComment,
	type OfficeCommentDraft,
	type OfficeCommentDrafts,
	type OfficeCommentThread,
	type OfficeCommentsClassNames,
	type OfficeCommentsLabels,
} from './types';

const INTERACTIVE = new Set(['BUTTON', 'TEXTAREA', 'INPUT', 'A', 'SELECT']);

/**
 * `<office-ui-comments-pane>`: Office's comments pane, one UX for Word, Excel and PowerPoint.
 * Threads show each comment's avatar initials, author, time and text, with Reply,
 * Resolve/Reopen, Edit (own comments, by `currentAuthor`) and Delete, under a new-comment box.
 * The pane never changes its threads: every action is an event and the product sets `threads`
 * again. Arrow keys, Home and End move between threads; Enter or Space (or a click) selects one
 * (`thread-select`) so the product can go to its anchor. Escape is left to the host.
 *
 * Properties: `threads`, `activeThreadId`, `readOnly` (controls shown but disabled),
 * `listOnly` (no composer, replies or actions: a navigation list), `closable`, `addDisabled`,
 * `currentAuthor`, `labels` (partial, English defaults), `classNames` (product hook classes),
 * `locale` (time formatting), `mentionCandidates` (people an `@` in any box offers, in a list
 * under it: arrows move, Enter, Tab or a click picks, Escape closes; none offers nothing).
 * A comment's `mentions` are drawn as spans. Events (bubbling, composed): `comment-add`
 * `{ text, mentions? }`, `comment-reply` `{ threadId, text, mentions? }`, `comment-edit`
 * `{ threadId, commentId, text, mentions? }` (`mentions`, the posted text's spans, only when
 * people are offered or the edited comment had mentions), `comment-delete`
 * `{ threadId, commentId }`, `thread-resolve`, `thread-reopen` and `thread-select`
 * `{ threadId }`, `comments-close`.
 */
export class OfficeUiCommentsPane extends OfficeElement {
	static override styles = controlStyles(css);
	static override properties = {
		threads: { attribute: false },
		activeThreadId: { attribute: 'active-thread-id', type: String },
		readOnly: { attribute: 'read-only', ...flag },
		listOnly: { attribute: 'list-only', ...flag },
		closable: flag,
		addDisabled: { attribute: 'add-disabled', ...flag },
		currentAuthor: { attribute: 'current-author', type: String },
		labels: { attribute: false },
		classNames: { attribute: false },
		locale: { type: String },
		mentionCandidates: { attribute: false },
	};
	declare threads: readonly OfficeCommentThread[];
	declare activeThreadId: string | null;
	declare readOnly: boolean;
	declare listOnly: boolean;
	declare closable: boolean;
	declare addDisabled: boolean;
	declare currentAuthor: string | null;
	declare labels: Partial<OfficeCommentsLabels>;
	declare classNames: OfficeCommentsClassNames;
	declare locale: string | null;
	declare mentionCandidates: readonly OfficeMentionCandidate[];
	private focusedId: string | undefined;
	private editingId: string | undefined;
	private readonly mentions = new MentionTypeahead({
		requestUpdate: () => this.requestUpdate(),
		offeredMentions: () => (this.offersMentions ? this.mentionCandidates : []),
	});

	constructor() {
		super();
		this.threads = [];
		this.activeThreadId = null;
		this.readOnly = false;
		this.listOnly = false;
		this.closable = false;
		this.addDisabled = false;
		this.currentAuthor = null;
		this.labels = {};
		this.classNames = {};
		this.locale = null;
		this.mentionCandidates = [];
	}

	protected override willUpdate(changed: PropertyValues<this>): void {
		super.willUpdate(changed);
		if (changed.has('mentionCandidates') || changed.has('readOnly')) this.mentions.refresh();
	}

	private get text(): OfficeCommentsLabels {
		return { ...DEFAULT_COMMENTS_LABELS, ...this.labels };
	}

	private get locked(): boolean {
		return present(this.readOnly);
	}

	private get offersMentions(): boolean {
		return this.mentionCandidates.length > 0 && !this.locked;
	}

	/** The posted text's spans, when the event carries them (see the class comment). */
	private carried(mentions: OfficeCommentMention[], had = false) {
		return this.offersMentions || had ? { mentions } : {};
	}

	/** The thread that takes Tab focus: the last one focused, else the active one, else the first. */
	private get rovingId(): string | undefined {
		const ids = this.threads.map((thread) => thread.id);
		if (this.focusedId && ids.includes(this.focusedId)) return this.focusedId;
		if (this.activeThreadId && ids.includes(this.activeThreadId)) return this.activeThreadId;
		return ids[0];
	}

	private card(id: string | undefined): HTMLElement | null {
		if (id === undefined) return null;
		return (
			[...this.renderRoot.querySelectorAll<HTMLElement>('.thread')].find(
				(card) => card.dataset.threadId === id,
			) ?? null
		);
	}

	/** Focus the current thread, or the new-comment box when there is none. */
	override focus(options?: FocusOptions): void {
		const target =
			this.card(this.rovingId) ?? this.renderRoot.querySelector<HTMLElement>('textarea');
		if (target) target.focus(options);
		else super.focus(options);
	}

	/**
	 * What the boxes hold that is not posted yet (the new comment, each shown thread's reply, the
	 * comment being edited) with their mentions, for a host that drops the pane to hand to the next
	 * one through {@link restoreDrafts}. Empty boxes are left out.
	 */
	drafts(): OfficeCommentDrafts {
		const root = this.shadowRoot!;
		const read = (key: string, box: HTMLTextAreaElement | null): OfficeCommentDraft | undefined => {
			if (!box?.value) return undefined;
			const { text, mentions } = this.mentions.snapshot(key, box.value);
			return mentions.length ? { text, mentions } : { text };
		};
		const drafts: OfficeCommentDrafts = {};
		const comment = read('new', root.querySelector('textarea.new'));
		if (comment) drafts.comment = comment;
		const replies: Record<string, OfficeCommentDraft> = {};
		for (const card of root.querySelectorAll<HTMLElement>('[data-thread-id]')) {
			const reply = read(
				`reply:${card.dataset.threadId}`,
				card.querySelector('textarea.reply-box'),
			);
			if (reply) replies[card.dataset.threadId!] = reply;
		}
		if (Object.keys(replies).length) drafts.replies = replies;
		const edit = this.editingId && read('edit', root.querySelector('textarea.edit-box'));
		if (edit) drafts.edit = { commentId: this.editingId!, ...edit };
		return drafts;
	}

	/**
	 * Put {@link drafts} back (another pane's, or this one's from before its threads changed): each
	 * box takes its draft or is emptied, and an edit reopens on its comment. A draft for a thread or
	 * comment the pane does not show is skipped.
	 */
	restoreDrafts(drafts: OfficeCommentDrafts | null | undefined): void {
		const shown = (id: string) => this.threads.some((t) => t.comments.some((c) => c.id === id));
		const edit = drafts?.edit && !this.locked && shown(drafts.edit.commentId) ? drafts.edit : null;
		this.editingId = edit?.commentId;
		this.requestUpdate();
		const root = this.shadowRoot!;
		const fill = (
			key: string,
			box: HTMLTextAreaElement | null,
			draft?: OfficeCommentDraft | null,
		) => {
			if (!box) return;
			box.value = draft?.text ?? '';
			if (draft?.text) this.mentions.seed(key, draft.text, draft.mentions);
			else this.mentions.clear(key);
		};
		fill('new', root.querySelector('textarea.new'), drafts?.comment);
		for (const card of root.querySelectorAll<HTMLElement>('[data-thread-id]')) {
			const key = `reply:${card.dataset.threadId}`;
			fill(
				key,
				card.querySelector('textarea.reply-box'),
				drafts?.replies?.[card.dataset.threadId!],
			);
		}
		if (edit) fill('edit', root.querySelector('textarea.edit-box'), edit);
		else this.mentions.clear('edit');
	}

	private submitNew(): void {
		const box = this.renderRoot.querySelector<HTMLTextAreaElement>('textarea.new');
		if (!box || this.locked || present(this.addDisabled)) return;
		const { text, mentions } = this.mentions.take('new', box);
		if (!text) return;
		box.value = '';
		this.mentions.clear('new');
		this.fire('comment-add', { text, ...this.carried(mentions) });
	}

	private submitReply(threadId: string): void {
		const box = this.card(threadId)?.querySelector<HTMLTextAreaElement>('textarea.reply-box');
		const key = `reply:${threadId}`;
		if (!box || this.locked) return;
		const { text, mentions } = this.mentions.take(key, box);
		if (!text) return;
		box.value = '';
		this.mentions.clear(key);
		this.fire('comment-reply', { threadId, text, ...this.carried(mentions) });
	}

	private startEdit(comment: OfficeComment): void {
		this.editingId = comment.id;
		this.mentions.seed('edit', comment.text, comment.mentions);
		this.requestUpdate();
		this.renderRoot.querySelector<HTMLTextAreaElement>('textarea.edit-box')?.focus();
	}

	private stopEdit(): void {
		this.editingId = undefined;
		this.mentions.clear('edit');
		this.requestUpdate();
	}

	private saveEdit(thread: OfficeCommentThread, comment: OfficeComment): void {
		const box = this.renderRoot.querySelector<HTMLTextAreaElement>('textarea.edit-box');
		const posted = box ? this.mentions.take('edit', box) : undefined;
		this.stopEdit();
		const text = posted?.text;
		if (!posted || !text || this.locked) return;
		const carried = this.carried(posted.mentions, Boolean(comment.mentions?.length));
		// Compare with what the box held when the edit began (its line breaks, trimmed): an edit that
		// only adds, replaces or drops a mention still changes the comment; no change sends nothing.
		const shown = normalizeLineBreaks(comment.text, comment.mentions);
		const before = trimMentionText(shown.text, shown.mentions);
		const spans = 'mentions' in carried ? carried.mentions : before.mentions;
		if (text === before.text && sameMentions(spans, before.mentions)) return;
		this.fire('comment-edit', { threadId: thread.id, commentId: comment.id, text, ...carried });
	}

	/** A box and its mention list: typing, caret moves and leaving the box drive the typeahead. */
	private field(key: string, box: TemplateResult): TemplateResult {
		const follow = (event: Event) => {
			if (event.target instanceof HTMLTextAreaElement) this.mentions.update(key, event.target);
		};
		return html`<div
			class="field"
			@input=${follow}
			@keyup=${follow}
			@click=${follow}
			@focusout=${(event: FocusEvent) => {
				// Focus moving onto an option (a screen reader activating it) keeps the list for its click.
				const next = event.relatedTarget;
				if (!(next instanceof Node && (event.currentTarget as Node).contains(next)))
					this.mentions.close(key);
			}}
			>${box}${this.mentions.render(key, this.text.mentions)}</div
		>`;
	}

	/** Ctrl+Enter (Cmd+Enter) posts from any box, like Office, unless the mention list takes the key. */
	private onBoxKey(event: KeyboardEvent, key: string, submit: () => void): void {
		if (this.mentions.keydown(key, event)) return;
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
			event.preventDefault();
			submit();
		}
	}

	private onEditKey(event: KeyboardEvent, thread: OfficeCommentThread, comment: OfficeComment) {
		if (this.mentions.keydown('edit', event)) return;
		if (event.key !== 'Escape')
			return this.onBoxKey(event, 'edit', () => this.saveEdit(thread, comment));
		// Escape cancels the edit only; the host keeps its own Escape for the pane.
		event.preventDefault();
		event.stopPropagation();
		this.stopEdit();
	}

	private select(threadId: string): void {
		this.focusedId = threadId;
		this.requestUpdate();
		this.fire('thread-select', { threadId });
	}

	private onThreadClick(event: MouseEvent, threadId: string): void {
		const inner = event
			.composedPath()
			.some((node) => node instanceof HTMLElement && INTERACTIVE.has(node.tagName));
		if (!inner) this.select(threadId);
	}

	private onListKey(event: KeyboardEvent): void {
		const card = event.composedPath()[0];
		if (!(card instanceof HTMLElement) || !card.classList.contains('thread')) return;
		const ids = this.threads.map((thread) => thread.id);
		const at = ids.indexOf(card.dataset.threadId ?? '');
		if (at < 0) return;
		const moves: Record<string, number> = {
			ArrowDown: Math.min(at + 1, ids.length - 1),
			ArrowUp: Math.max(at - 1, 0),
			Home: 0,
			End: ids.length - 1,
		};
		const move = moves[event.key];
		if (move !== undefined) {
			event.preventDefault();
			this.focusedId = ids[move];
			this.requestUpdate();
			this.card(this.focusedId)?.focus();
		} else if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			this.select(ids[at]!);
		}
	}

	private renderActions(thread: OfficeCommentThread, comment: OfficeComment, first: boolean) {
		if (present(this.listOnly)) return nothing;
		const l = this.text;
		const locked = this.locked;
		const own = Boolean(this.currentAuthor) && comment.author === this.currentAuthor;
		const threadId = thread.id;
		const status = thread.resolved ? 'reopen' : 'resolve';
		return html`<div class="actions"
			>${first ? html`<button type="button" data-action=${status} ?disabled=${locked} @click=${() => (thread.resolved ? this.fire('thread-reopen', { threadId }) : this.fire('thread-resolve', { threadId }))}>${thread.resolved ? l.reopen : l.resolve}</button>` : nothing}${own && this.editingId !== comment.id ? html`<button type="button" data-action="edit" ?disabled=${locked} @click=${() => this.startEdit(comment)}>${l.edit}</button>` : nothing}<button
				type="button"
				data-action="delete"
				?disabled=${locked}
				@click=${() => this.fire('comment-delete', { threadId, commentId: comment.id })}
				>${l.delete}</button
			></div
		>`;
	}

	/** A comment's text, its mentions drawn as spans (text only between nodes: `textContent` is exact). */
	private renderText(comment: OfficeComment) {
		if (!comment.mentions?.length) return comment.text;
		const hook = this.classNames.mention ?? '';
		return commentSegments(comment.text, comment.mentions).map((segment) =>
			segment.kind === 'mention'
				? html`<span
						class="mention ${hook}"
						data-office-comment-mention=${segment.id ?? ''}
						title=${ifDefined(segment.name)}
						>${segment.text}</span
					>`
				: segment.text,
		);
	}

	private renderComment(
		thread: OfficeCommentThread,
		comment: OfficeComment,
		first: boolean,
	): TemplateResult {
		const l = this.text;
		const time = formatCommentTime(comment.created, this.locale ?? undefined);
		const edit = this.mentions.aria('edit', this.offersMentions);
		const body =
			this.editingId === comment.id && !this.locked
				? html`<div class="edit">
						${this.field(
							'edit',
							html`<textarea
								class="edit-box"
								aria-label=${l.edit}
								aria-autocomplete=${ifDefined(edit.autocomplete)}
								aria-controls=${ifDefined(edit.controls)}
								aria-activedescendant=${ifDefined(edit.activeDescendant)}
								.value=${comment.text}
								@keydown=${(event: KeyboardEvent) => this.onEditKey(event, thread, comment)}
							></textarea>`,
						)}<div class="actions"
							><button
								type="button"
								data-action="save"
								@click=${() => this.saveEdit(thread, comment)}
								>${l.save}</button
							><button type="button" data-action="cancel" @click=${() => this.stopEdit()}
								>${l.cancel}</button
							></div
						></div
					>`
				: html`<p class="text">${this.renderText(comment)}</p>`;
		return html`<div
			class="comment ${first ? 'root' : 'reply'} ${this.classNames.comment ?? ''}"
			data-comment-id=${comment.id}
			data-resolved=${String(thread.resolved)}
			><div class="meta"
				><span
					class="avatar"
					aria-hidden="true"
					style=${ifDefined(comment.color ? `background:${comment.color}` : undefined)}
					>${comment.initials || commentInitials(comment.author)}</span
				><span class="author">${comment.author}</span
				>${time ? html`<time datetime=${ifDefined(comment.created)}>${time}</time>` : nothing}${comment.edited ? html`<span class="edited">${l.edited}</span>` : nothing}</div
			>${body}${this.renderActions(thread, comment, first)}</div
		>`;
	}

	private renderThread(thread: OfficeCommentThread, roving: string | undefined): TemplateResult {
		const l = this.text;
		const [first, ...replies] = thread.comments;
		const badge = thread.resolved && l.resolved;
		const key = `reply:${thread.id}`;
		const aria = this.mentions.aria(key, this.offersMentions);
		const anchor =
			thread.anchorLabel || badge
				? html`<div class="anchor"
						>${thread.anchorLabel ? html`<span class="anchor-label">${thread.anchorLabel}</span>` : nothing}${badge ? html`<span class="badge">${l.resolved}</span>` : nothing}</div
					>`
				: nothing;
		const reply = present(this.listOnly)
			? nothing
			: html`<div class="reply">
					${this.field(
						key,
						html`<textarea
							class="reply-box"
							aria-label=${l.reply}
							placeholder=${l.reply}
							aria-autocomplete=${ifDefined(aria.autocomplete)}
							aria-controls=${ifDefined(aria.controls)}
							aria-activedescendant=${ifDefined(aria.activeDescendant)}
							?disabled=${this.locked}
							@keydown=${(event: KeyboardEvent) =>
								this.onBoxKey(event, key, () => this.submitReply(thread.id))}
						></textarea>`,
					)}<button
						type="button"
						data-action="reply"
						?disabled=${this.locked}
						@click=${() => this.submitReply(thread.id)}
						>${l.reply}</button
					></div
				>`;
		return html`<article
			role="listitem"
			class="thread ${this.classNames.thread ?? ''}"
			data-thread-id=${thread.id}
			data-resolved=${String(thread.resolved)}
			aria-current=${ifDefined(thread.id === this.activeThreadId ? 'true' : undefined)}
			tabindex=${thread.id === roving ? '0' : '-1'}
			@click=${(event: MouseEvent) => this.onThreadClick(event, thread.id)}
			>${anchor}${first ? this.renderComment(thread, first, true) : nothing}${replies.map((comment) => this.renderComment(thread, comment, false))}${reply}</article
		>`;
	}

	protected override render() {
		const l = this.text;
		const closable = present(this.closable);
		const aria = this.mentions.aria('new', this.offersMentions);
		const header =
			l.heading || closable
				? html`<div class="header"
						>${l.heading ? html`<h2>${l.heading}</h2>` : nothing}${closable ? html`<button type="button" class="close" data-action="close" aria-label=${l.close} @click=${() => this.fire('comments-close', {})}>${l.close}</button>` : nothing}</div
					>`
				: nothing;
		const composer = present(this.listOnly)
			? nothing
			: html`<div class="composer">
					${this.field(
						'new',
						html`<textarea
							class="new"
							aria-label=${l.newComment}
							placeholder=${l.newComment}
							aria-autocomplete=${ifDefined(aria.autocomplete)}
							aria-controls=${ifDefined(aria.controls)}
							aria-activedescendant=${ifDefined(aria.activeDescendant)}
							?disabled=${this.locked}
							@keydown=${(event: KeyboardEvent) => this.onBoxKey(event, 'new', () => this.submitNew())}
						></textarea>`,
					)}<button
						type="button"
						data-action="add"
						?disabled=${this.locked || present(this.addDisabled)}
						@click=${() => this.submitNew()}
						>${l.add}</button
					></div
				>`;
		const roving = this.rovingId;
		const list = this.threads.length
			? html`<div class="threads" role="list" aria-label=${l.list} @keydown=${this.onListKey}
					>${repeat(
						this.threads,
						(thread) => thread.id,
						(thread) => this.renderThread(thread, roving),
					)}</div
				>`
			: html`<p class="empty">${l.empty}</p>`;
		return html`${header}${composer}${list}`;
	}
}

export const defineCommentsPane = definer('office-ui-comments-pane', () => OfficeUiCommentsPane);
