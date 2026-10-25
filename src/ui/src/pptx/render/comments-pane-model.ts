/**
 * PowerPoint's comments on the shared comments pane (`office-ui-comments-pane`): a slide's
 * comments as the pane's threads, the deck's modern comment authors as the people an `@` offers,
 * and the pane's events as the comment-list edits a binding writes back history-aware.
 *
 * Every binding draws its comments through this, so their panes cannot drift. DOM-free.
 *
 * @module render/comments-pane-model
 */
import type {
	PptxComment,
	PptxCommentMention,
	PptxElement,
	PptxModernCommentAuthor,
} from 'ooxml-core/pptx';

import type { OfficeCommentMention, OfficeMentionCandidate } from '../../comments/mentions';
import type {
	OfficeComment,
	OfficeCommentAddDetail,
	OfficeCommentDeleteDetail,
	OfficeCommentEditDetail,
	OfficeCommentReplyDetail,
	OfficeCommentThread,
	OfficeThreadDetail,
} from '../../comments/types';
import { defaultMentionId } from './comment-mentions';
import {
	addCommentToList,
	editCommentInList,
	removeCommentFromList,
	replyToCommentInList,
	toggleCommentResolvedInList,
} from './comments-list';
import { getElementLabel } from './element';

export interface PptxCommentsPaneOptions {
	/** The slide's elements: a comment on one is anchored by its label. */
	elements?: readonly PptxElement[];
	/** An element's label; its kind ("Shape", "Table", ...) by default, as the panes showed it. */
	elementLabel?: (element: PptxElement) => string;
	/** The anchor of a comment whose element is gone (the pane has no dictionary). */
	deletedElementLabel?: string;
	/** The author shown for a comment without one. */
	unknownAuthor?: string;
	/** The deck's modern comment authors, for avatar initials. */
	authors?: readonly PptxModernCommentAuthor[];
}

/** Where a mention record is found again: its mention id, else its place in the list. */
const recordKey = (mention: PptxCommentMention, index: number): string => mention.id ?? `#${index}`;

const paneMentions = (
	mentions: readonly PptxCommentMention[] | undefined,
): OfficeCommentMention[] =>
	(mentions ?? []).map((mention, index) => ({
		start: mention.startIndex,
		length: mention.length,
		id: mention.personId,
		...(mention.authorName ? { name: mention.authorName } : {}),
		key: recordKey(mention, index),
	}));

function paneComment(comment: PptxComment, options: PptxCommentsPaneOptions): OfficeComment {
	const initials = comment.authorId
		? options.authors?.find((author) => author.id === comment.authorId)?.initials
		: undefined;
	const mentions = paneMentions(comment.mentions);
	return {
		id: comment.id,
		author: comment.author || options.unknownAuthor || '',
		...(initials ? { initials } : {}),
		...(comment.createdAt ? { created: comment.createdAt } : {}),
		text: comment.text,
		...(mentions.length > 0 ? { mentions } : {}),
	};
}

/** Replies at any depth, each before its own replies (the pane shows one level). */
const repliesOf = (comment: PptxComment): PptxComment[] =>
	(comment.replies ?? []).flatMap((reply) => [reply, ...repliesOf(reply)]);

function anchorOf(comment: PptxComment, options: PptxCommentsPaneOptions): string | undefined {
	if (!comment.elementId || !options.elements) {
		return undefined;
	}
	const element = options.elements.find((entry) => entry.id === comment.elementId);
	return element ? (options.elementLabel ?? getElementLabel)(element) : options.deletedElementLabel;
}

/** A slide's comments as the pane's threads: each top-level comment with its replies. */
export function pptxCommentThreads(
	comments: readonly PptxComment[],
	options: PptxCommentsPaneOptions = {},
): OfficeCommentThread[] {
	return comments.map((comment) => {
		const anchorLabel = anchorOf(comment, options);
		return {
			id: comment.id,
			...(anchorLabel ? { anchorLabel } : {}),
			resolved: Boolean(comment.resolved),
			comments: [comment, ...repliesOf(comment)].map((entry) => paneComment(entry, options)),
		};
	});
}

/** The people an `@` offers: the deck's modern comment authors with an id and a name. */
export function pptxMentionCandidates(
	authors: readonly PptxModernCommentAuthor[] | undefined,
): OfficeMentionCandidate[] {
	return (authors ?? [])
		.filter((author) => author.id && author.name)
		.map((author) => ({
			id: author.id,
			name: author.name,
			...(author.initials ? { initials: author.initials } : {}),
		}));
}

/**
 * The pane's spans as mention records. A span with a `key` keeps the record behind it (its mention
 * id, extension and markup) at its new place; a new pick becomes a new record with a new mention id;
 * a span with neither is dropped. A record found by its place (no mention id) is kept only for the
 * span's own person: a list that changed under an edit (a collaborator removed a mention) moves
 * every later place, so a stale key that now finds someone else becomes a new record instead.
 */
export function pptxMentionRecords(
	spans: readonly OfficeCommentMention[],
	previous: readonly PptxCommentMention[] | undefined,
	generateId: () => string = defaultMentionId,
): PptxCommentMention[] {
	const byKey = new Map(
		(previous ?? []).map((record, index) => [recordKey(record, index), record]),
	);
	return spans.flatMap((span): PptxCommentMention[] => {
		const found = span.key === undefined ? undefined : byKey.get(span.key);
		const record = found && (!span.id || found.personId === span.id) ? found : undefined;
		if (record) {
			return [{ ...record, startIndex: span.start, length: span.length }];
		}
		if (!span.id) {
			return [];
		}
		return [
			{
				id: generateId(),
				personId: span.id,
				...(span.name ? { authorName: span.name } : {}),
				startIndex: span.start,
				length: span.length,
			},
		];
	});
}

/** One of the pane's comment events, with its detail. */
export type PptxCommentsPaneEvent =
	| { type: 'comment-add'; detail: OfficeCommentAddDetail }
	| { type: 'comment-reply'; detail: OfficeCommentReplyDetail }
	| { type: 'comment-edit'; detail: OfficeCommentEditDetail }
	| { type: 'comment-delete'; detail: OfficeCommentDeleteDetail }
	| { type: 'thread-resolve' | 'thread-reopen'; detail: OfficeThreadDetail };

export interface PptxCommentsPaneContext {
	/** Who writes new comments and replies. */
	authorName: string;
	/** The element a new comment is on (the selection), if any. */
	elementId?: string;
	/** A new mention's id; a brace-wrapped GUID by default. */
	generateMentionId?: () => string;
}

const findComment = (comments: readonly PptxComment[], id: string): PptxComment | undefined => {
	for (const comment of comments) {
		const found = comment.id === id ? comment : findComment(comment.replies ?? [], id);
		if (found) {
			return found;
		}
	}
	return undefined;
};

/**
 * The slide's comments after a pane event, or `null` when it changed nothing (the shared
 * comment-list contract, so the binding records no undo step).
 */
export function applyCommentsPaneEvent(
	comments: PptxComment[],
	event: PptxCommentsPaneEvent,
	context: PptxCommentsPaneContext,
): PptxComment[] | null {
	const records = (spans: readonly OfficeCommentMention[] | undefined, previous?: PptxComment) =>
		spans ? pptxMentionRecords(spans, previous?.mentions, context.generateMentionId) : undefined;
	switch (event.type) {
		case 'comment-add':
			return addCommentToList(
				comments,
				event.detail.text,
				context.authorName,
				undefined,
				undefined,
				context.elementId,
				records(event.detail.mentions),
			);
		case 'comment-reply':
			return replyToCommentInList(
				comments,
				event.detail.threadId,
				event.detail.text,
				context.authorName,
				records(event.detail.mentions),
			);
		case 'comment-edit': {
			const { commentId, text, mentions } = event.detail;
			return editCommentInList(
				comments,
				commentId,
				text,
				records(mentions, findComment(comments, commentId)),
			);
		}
		case 'comment-delete':
			return removeCommentFromList(comments, event.detail.commentId);
		case 'thread-resolve':
		case 'thread-reopen': {
			const thread = comments.find((comment) => comment.id === event.detail.threadId);
			if (!thread || Boolean(thread.resolved) === (event.type === 'thread-resolve')) {
				return null;
			}
			return toggleCommentResolvedInList(comments, thread.id);
		}
	}
}
