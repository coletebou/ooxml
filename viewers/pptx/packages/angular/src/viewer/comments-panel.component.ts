/**
 * comments-panel.component.ts: the active slide's comments in the shared comments pane.
 *
 * Selector: `pptx-comments-panel`
 *
 * Mounts `pptx-ui-comments-pane` (the shared Office comments pane) and drives it with the shared
 * `createPptxCommentsPaneBinding`, as every binding does. Every change the pane makes comes out
 * of `commentsChange` as the active slide's whole new comment list, which the viewer writes as
 * one undo step. `add`, `reply`, `edit`, `remove` and `resolve` still announce each change for a
 * host that handles them itself.
 *
 * Usage:
 * ```html
 * <pptx-comments-panel
 *   [comments]="slideComments()"
 *   [authorName]="userName()"
 *   [elements]="slide().elements"
 *   (commentsChange)="writeComments($event)"
 * />
 * ```
 */

import {
	ChangeDetectionStrategy,
	Component,
	CUSTOM_ELEMENTS_SCHEMA,
	effect,
	ElementRef,
	inject,
	input,
	output,
	signal,
} from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import {
	createPptxCommentsPaneBinding,
	pptxMentionRecords,
	registerPptxWebControls,
} from 'ooxml-ui/pptx';
import type {
	PptxCommentDrafts,
	PptxCommentsPaneBinding,
	PptxCommentsPaneElement,
	PptxCommentsPaneEvent,
} from 'ooxml-ui/pptx';
import type {
	PptxComment,
	PptxCommentMention,
	PptxElement,
	PptxModernCommentAuthor,
} from 'pptx-viewer-core';

import { translationsSignal } from './translations-signal';

/** The trimmed text plus the mention spans an add/reply submit carries. */
export interface CommentSubmission {
	text: string;
	mentions: PptxCommentMention[];
}

/** One pane change as the panel's per-change outputs announce it. */
export type CommentsPanelIntent =
	| { output: 'add'; value: CommentSubmission }
	| { output: 'reply'; value: { parentId: string } & CommentSubmission }
	| { output: 'edit'; value: { id: string } & CommentSubmission }
	| { output: 'remove'; value: string }
	| { output: 'resolve'; value: string };

const PANE_EVENTS: readonly PptxCommentsPaneEvent['type'][] = [
	'comment-add',
	'comment-reply',
	'comment-edit',
	'comment-delete',
	'thread-resolve',
	'thread-reopen',
];

function findComment(comments: readonly PptxComment[], id: string): PptxComment | undefined {
	for (const comment of comments) {
		const found = comment.id === id ? comment : findComment(comment.replies ?? [], id);
		if (found) {
			return found;
		}
	}
	return undefined;
}

/**
 * The per-change output a pane event maps to, its mention spans turned into `p188` records (an
 * edited comment keeps the records it had). `resolve` toggles, as it always did.
 */
export function commentsPanelIntent(
	event: PptxCommentsPaneEvent,
	comments: readonly PptxComment[],
): CommentsPanelIntent {
	switch (event.type) {
		case 'comment-add':
			return {
				output: 'add',
				value: {
					text: event.detail.text,
					mentions: pptxMentionRecords(event.detail.mentions ?? [], undefined),
				},
			};
		case 'comment-reply':
			return {
				output: 'reply',
				value: {
					parentId: event.detail.threadId,
					text: event.detail.text,
					mentions: pptxMentionRecords(event.detail.mentions ?? [], undefined),
				},
			};
		case 'comment-edit': {
			const { commentId, text, mentions } = event.detail;
			const previous = findComment(comments, commentId)?.mentions;
			return {
				output: 'edit',
				value: {
					id: commentId,
					text,
					mentions: mentions ? pptxMentionRecords(mentions, previous) : (previous ?? []),
				},
			};
		}
		case 'comment-delete':
			return { output: 'remove', value: event.detail.commentId };
		case 'thread-resolve':
		case 'thread-reopen':
			return { output: 'resolve', value: event.detail.threadId };
	}
}

@Component({
	selector: 'pptx-comments-panel',
	standalone: true,
	changeDetection: ChangeDetectionStrategy.OnPush,
	schemas: [CUSTOM_ELEMENTS_SCHEMA],
	template: '<pptx-ui-comments-pane class="pptx-ng-comments"></pptx-ui-comments-pane>',
	styles: `
		:host {
			display: block;
			height: 100%;
			width: 100%;
		}
		.pptx-ng-comments {
			display: block;
			height: 100%;
			width: 100%;
		}
		/* Touch target: MIN_TOUCH_TARGET_PX (44) from render/responsive. The pane draws its buttons
		   in its shadow root; its sizing token reaches them (an outer rule beats its own :host). */
		@media (max-width: 767px) {
			.pptx-ng-comments {
				--office-input-height: 44px;
			}
		}
	`,
})
export class CommentsPanelComponent {
	private readonly translate = inject(TranslateService);

	/** The active slide's comments (already filtered to the active slide). */
	readonly comments = input<PptxComment[]>([]);
	/** Who new comments are written as, and whose comments offer Edit. */
	readonly authorName = input<string>(this.translate.instant('pptx.comments.defaultAuthorName'));
	/** Office 2021 modern comment authors: the people an `@` offers. */
	readonly modernCommentAuthors = input<readonly PptxModernCommentAuthor[]>([]);
	/** The active slide's elements, for each thread's anchor. */
	readonly elements = input<readonly PptxElement[]>([]);
	/** A new comment goes on this element (the selection). */
	readonly selectedElementId = input<string | null>(null);
	/** False shows the controls disabled. */
	readonly editable = input<boolean>(true);
	/** The pane's own "Comments" heading; off inside a surface that is titled already. */
	readonly showHeading = input<boolean>(true);
	/** The viewer's store of unposted comments, so a draft outlives this panel. */
	readonly drafts = input<PptxCommentDrafts | undefined>(undefined);
	/** The slide the drafts belong to (its id). */
	readonly draftKey = input<string | null>(null);

	/** The active slide's whole new comment list after a change (write it as one undo step). */
	readonly commentsChange = output<PptxComment[]>();
	/** A thread was picked: its comment, and the element it is on. */
	readonly threadSelect = output<{ commentId: string; elementId?: string }>();
	/** Emits the trimmed comment text (+ mentions) the user added. */
	readonly add = output<CommentSubmission>();
	/** Emits the parent comment id + trimmed text (+ mentions) of a threaded reply. */
	readonly reply = output<{ parentId: string } & CommentSubmission>();
	/** Emits an edited comment's id, new text and mentions. */
	readonly edit = output<{ id: string } & CommentSubmission>();
	/** Emits the id of a comment the user removed. */
	readonly remove = output<string>();
	/** Emits the id of a thread whose resolved flag should toggle. */
	readonly resolve = output<string>();

	private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
	private readonly binding = signal<PptxCommentsPaneBinding | null>(null);
	/** Re-syncs the pane's strings when the language or its dictionary changes. */
	private readonly translations = translationsSignal(this.translate);

	constructor() {
		registerPptxWebControls();
		// Once, with the rendered pane (read from the DOM: no signal query, so the JIT test build
		// that does not wire signal queries drives the same path).
		effect((onCleanup) => {
			const element =
				this.host.nativeElement.querySelector<PptxCommentsPaneElement>('pptx-ui-comments-pane');
			if (!element) {
				return;
			}
			onCleanup(this.attach(element));
		});
		effect(() => {
			this.translations();
			this.binding()?.sync({
				comments: this.comments(),
				editable: this.editable(),
				authorName: this.authorName(),
				authors: this.modernCommentAuthors(),
				elements: this.elements(),
				selectedElementId: this.selectedElementId(),
				t: (key) => this.translate.instant(key),
				showHeading: this.showHeading(),
				draftKey: this.draftKey(),
			});
		});
	}

	/** Drive `element`; returns the detach. Called with the rendered pane. */
	attach(element: PptxCommentsPaneElement): () => void {
		const controller = new AbortController();
		const drafts = this.drafts();
		const binding = createPptxCommentsPaneBinding(element, {
			applyComments: (next) => this.commentsChange.emit(next),
			selectThread: (commentId, elementId) =>
				this.threadSelect.emit({ commentId, ...(elementId ? { elementId } : {}) }),
			...(drafts ? { drafts } : {}),
		});
		for (const type of PANE_EVENTS) {
			element.addEventListener(
				type,
				(event) => {
					if (!this.editable()) {
						return;
					}
					const detail = (event as CustomEvent).detail as never;
					this.announce(
						commentsPanelIntent({ type, detail } as PptxCommentsPaneEvent, this.comments()),
					);
				},
				{ signal: controller.signal },
			);
		}
		this.binding.set(binding);
		return () => {
			controller.abort();
			binding.dispose();
			this.binding.set(null);
		};
	}

	private announce(intent: CommentsPanelIntent): void {
		switch (intent.output) {
			case 'add':
				this.add.emit(intent.value);
				break;
			case 'reply':
				this.reply.emit(intent.value);
				break;
			case 'edit':
				this.edit.emit(intent.value);
				break;
			case 'remove':
				this.remove.emit(intent.value);
				break;
			case 'resolve':
				this.resolve.emit(intent.value);
				break;
		}
	}
}
