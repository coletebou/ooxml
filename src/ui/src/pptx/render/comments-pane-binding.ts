/**
 * Drives `pptx-ui-comments-pane` (the shared comments pane) for one binding: the active slide's
 * comments in, the pane's events out as one history-aware write per edit. The binding mounts the
 * element, calls {@link PptxCommentsPaneBinding.sync} whenever what it shows changes, and supplies
 * the host callbacks; everything between is here, so the five panes behave the same.
 *
 * @module render/comments-pane-binding
 */
import type { PptxComment, PptxElement, PptxModernCommentAuthor } from 'ooxml-core/pptx';

import type { OfficeUiCommentsPane } from '../../comments/comments-pane';
import type { OfficeCommentsLabels } from '../../comments/types';
import { COMMENT_MENTION_CLASS } from './comment-mentions';
import {
	applyCommentsPaneEvent,
	pptxCommentThreads,
	pptxMentionCandidates,
	type PptxCommentsPaneEvent,
} from './comments-pane-model';

/** The `pptx-ui-comments-pane` element a binding mounts and hands to {@link createPptxCommentsPaneBinding}. */
export type PptxCommentsPaneElement = OfficeUiCommentsPane;

/** What the pane asks of the viewer; each binding maps these onto its own store or callbacks. */
export interface PptxCommentsPaneHost {
	/** Write the active slide's new comment list as ONE history entry. */
	applyComments(next: PptxComment[]): void;
	/** A thread was picked (click, Enter or Space): its comment, and the element it is on. */
	selectThread?(commentId: string, elementId: string | undefined): void;
	/** The pane's close button (shown when the input asks for it). */
	close?(): void;
}

/** Everything the pane shows; call {@link PptxCommentsPaneBinding.sync} when it changes. */
export interface PptxCommentsPaneInput {
	/** The active slide's comments. */
	comments: readonly PptxComment[];
	editable: boolean;
	/** Who writes new comments, and whose comments offer Edit. */
	authorName: string;
	/** The deck's modern comment authors: the people an `@` offers. */
	authors?: readonly PptxModernCommentAuthor[];
	/** The active slide's elements, for anchors. */
	elements?: readonly PptxElement[];
	/** A new comment goes on this element (the selection). */
	selectedElementId?: string | null;
	/** The thread holding this comment is marked current (the ribbon's comment cursor). */
	activeCommentId?: string | null;
	/** The binding's translator (pptx dictionary keys). */
	t: (key: string) => string;
	closable?: boolean;
	/** Draw the pane's own "Comments" heading; off inside a surface that is titled already. */
	showHeading?: boolean;
	locale?: string | null;
}

export interface PptxCommentsPaneBinding {
	sync(input: PptxCommentsPaneInput): void;
	/** Detach the pane's listeners (the element itself stays with the binding). */
	dispose(): void;
}

/** The pane's strings from the pptx dictionary (no new keys: the panes used these). */
export function pptxCommentsLabels(t: (key: string) => string): Partial<OfficeCommentsLabels> {
	return {
		heading: t('pptx.toolbar.comments'),
		list: t('pptx.toolbar.comments'),
		close: t('pptx.common.close'),
		newComment: t('pptx.comments.addPlaceholder'),
		add: t('pptx.comments.addComment'),
		reply: t('pptx.comments.reply'),
		resolve: t('pptx.comments.resolve'),
		reopen: t('pptx.comments.unresolve'),
		resolved: t('pptx.comments.resolved'),
		edit: t('pptx.comments.edit'),
		save: t('pptx.comments.save'),
		cancel: t('pptx.comments.cancel'),
		delete: t('pptx.comments.delete'),
		empty: t('pptx.comments.noneOnSlide'),
		mentions: t('pptx.comments.mentionSuggestions'),
	};
}

const EVENTS: readonly PptxCommentsPaneEvent['type'][] = [
	'comment-add',
	'comment-reply',
	'comment-edit',
	'comment-delete',
	'thread-resolve',
	'thread-reopen',
];

/** The id of the top-level comment whose thread holds `id` (itself or a reply at any depth). */
function threadOf(comments: readonly PptxComment[], id: string | null | undefined): string | null {
	if (!id) {
		return null;
	}
	const holds = (comment: PptxComment): boolean =>
		comment.id === id || (comment.replies ?? []).some(holds);
	return comments.find(holds)?.id ?? null;
}

export function createPptxCommentsPaneBinding(
	element: OfficeUiCommentsPane,
	host: PptxCommentsPaneHost,
): PptxCommentsPaneBinding {
	let input: PptxCommentsPaneInput | null = null;
	const controller = new AbortController();
	const listen = (type: string, handler: (detail: never) => void): void =>
		element.addEventListener(type, (event) => handler((event as CustomEvent).detail as never), {
			signal: controller.signal,
		});

	for (const type of EVENTS) {
		listen(type, (detail) => {
			if (!input?.editable) {
				return;
			}
			const next = applyCommentsPaneEvent(
				[...input.comments],
				{ type, detail } as PptxCommentsPaneEvent,
				{
					authorName: input.authorName,
					...(input.selectedElementId ? { elementId: input.selectedElementId } : {}),
				},
			);
			if (next) {
				host.applyComments(next);
			}
		});
	}
	listen('thread-select', ({ threadId }: { threadId: string }) => {
		const comment = input?.comments.find((entry) => entry.id === threadId);
		host.selectThread?.(threadId, comment?.elementId);
	});
	listen('comments-close', () => host.close?.());
	// A key the pane used (moving between threads, picking a mention, posting) stays in it: the
	// viewer root pages slides on the same arrows, Home and End.
	element.addEventListener(
		'keydown',
		(event) => {
			if (event.defaultPrevented) {
				event.stopPropagation();
			}
		},
		{ signal: controller.signal },
	);

	return {
		sync(next) {
			input = next;
			const { t } = next;
			element.threads = pptxCommentThreads(next.comments, {
				...(next.elements ? { elements: next.elements } : {}),
				deletedElementLabel: t('pptx.comments.deletedElement'),
				unknownAuthor: t('pptx.comments.unknownAuthor'),
				...(next.authors ? { authors: next.authors } : {}),
			});
			element.mentionCandidates = pptxMentionCandidates(next.authors);
			element.readOnly = !next.editable;
			element.currentAuthor = next.authorName;
			element.closable = Boolean(next.closable);
			element.labels = {
				...pptxCommentsLabels(t),
				...(next.showHeading === false ? { heading: '' } : {}),
			};
			// A titled surface frames the pane, so it draws no box of its own there (host styles).
			element.toggleAttribute('data-pptx-embedded', next.showHeading === false);
			element.classNames = {
				thread: 'pptx-comment-thread',
				comment: 'pptx-comment',
				mention: COMMENT_MENTION_CLASS,
			};
			element.activeThreadId = threadOf(next.comments, next.activeCommentId);
			element.locale = next.locale ?? null;
		},
		dispose() {
			controller.abort();
		},
	};
}
