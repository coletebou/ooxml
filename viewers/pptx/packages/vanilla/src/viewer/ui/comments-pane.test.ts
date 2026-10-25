import { createPptxCommentDrafts } from 'ooxml-ui/pptx';
import type { PptxComment, PptxElement } from 'pptx-viewer-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTranslator } from '../i18n';
import {
	combineCommentMentionAuthors,
	commentsPanelRoot,
	createCommentsPane,
	openCommentsPanel,
} from './comments-pane';
import type { CommentsPaneView } from './comments-pane';

const t = createTranslator();
afterEach(() => document.body.replaceChildren());

const SHAPE = { id: 'shape-1', type: 'shape', name: 'Title' } as unknown as PptxElement;
const ELEMENTS = [SHAPE];
const ALICE = { id: 'a1', name: 'Alice', userId: '', providerId: '' };
const view = (
	comments: PptxComment[],
	extra: Partial<CommentsPaneView> = {},
): CommentsPaneView => ({
	comments,
	editable: true,
	authorName: 'Ada',
	elements: ELEMENTS,
	...extra,
});
const button = (root: ParentNode, label: string) =>
	[...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;
/** Type into a box with the caret at the end, as the browser reports it. */
function type(box: HTMLTextAreaElement, value: string): void {
	box.value = value;
	box.setSelectionRange(value.length, value.length);
	box.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

/** A model the test drives: `set` replaces what it reads and notifies. */
function liveModel(initial: CommentsPaneView) {
	let current = initial;
	const listeners = new Set<() => void>();
	const unsubscribe = vi.fn();
	return {
		model: {
			read: () => current,
			subscribe: (listener: () => void) => {
				listeners.add(listener);
				return () => {
					unsubscribe();
					listeners.delete(listener);
				};
			},
		},
		set(next: CommentsPaneView) {
			current = next;
			for (const listener of listeners) {
				listener();
			}
		},
		unsubscribe,
	};
}

describe('workspace comments pane', () => {
	it('posts a new comment on the selected element as one comment list, and stays open', () => {
		const applyComments = vi.fn();
		const { model } = liveModel(view([], { selectedElementId: 'shape-1' }));
		const pane = openCommentsPanel(document, document.body, t, model, { applyComments });
		const root = pane.shadowRoot!;
		type(root.querySelector<HTMLTextAreaElement>('textarea.new')!, '  Review this');
		button(root, t('pptx.comments.addComment')).click();

		expect(applyComments).toHaveBeenCalledOnce();
		expect(applyComments.mock.calls[0]![0]).toMatchObject([
			{ text: 'Review this', author: 'Ada', elementId: 'shape-1' },
		]);
		expect(document.querySelector('[data-pptx-comments-panel]')).toBe(pane);
		expect(root.querySelector<HTMLTextAreaElement>('textarea.new')!.value).toBe('');
	});

	it('follows the model: a resolve made elsewhere redraws in place', () => {
		const comment: PptxComment = { id: 'c1', text: 'First pass', author: 'Alice' };
		const live = liveModel(view([comment]));
		const pane = openCommentsPanel(document, document.body, t, live.model, {
			applyComments: vi.fn(),
		});
		const thread = () => pane.shadowRoot!.querySelector<HTMLElement>('[data-thread-id="c1"]')!;
		expect(thread().dataset.resolved).toBe('false');
		live.set(view([{ ...comment, resolved: true }]));
		expect(thread().dataset.resolved).toBe('true');
	});

	it('posts a reply, with its mention on the trimmed text', () => {
		const applyComments = vi.fn();
		const { model } = liveModel(
			view([{ id: 'c1', text: 'First pass', author: 'Alice' }], { authors: [ALICE] }),
		);
		const root = openCommentsPanel(document, document.body, t, model, {
			applyComments,
		}).shadowRoot!;
		type(root.querySelector<HTMLTextAreaElement>('textarea.reply-box')!, ' ok @al');
		root.querySelector<HTMLElement>('[role="option"]')!.click();
		button(root, t('pptx.comments.reply')).click();

		const [reply] = (applyComments.mock.calls[0]![0] as PptxComment[])[0]!.replies!;
		expect(reply!.text).toBe('ok @Alice');
		const mention = reply!.mentions![0]!;
		expect(reply!.text.slice(mention.startIndex, mention.startIndex + mention.length)).toBe(
			'@Alice',
		);
		expect(mention.personId).toBe('a1');
	});

	it('closes from its own button and stops following the model', () => {
		const live = liveModel(view([]));
		const pane = openCommentsPanel(document, document.body, t, live.model, {
			applyComments: vi.fn(),
		});
		pane.shadowRoot!.querySelector<HTMLButtonElement>('button.close')!.click();
		expect(document.querySelector('[data-pptx-comments-panel]')).toBeNull();
		expect(live.unsubscribe).toHaveBeenCalledOnce();
	});

	it('replaces an open pane, and gives the review commands its rows', () => {
		const first = liveModel(view([]));
		openCommentsPanel(document, document.body, t, first.model, { applyComments: vi.fn() });
		const { model } = liveModel(view([{ id: 'c1', text: 'Here', author: 'Alice' }]));
		const pane = openCommentsPanel(document, document.body, t, model, { applyComments: vi.fn() });

		expect(document.querySelectorAll('[data-pptx-comments-panel]')).toHaveLength(1);
		expect(first.unsubscribe).toHaveBeenCalledOnce();
		expect(commentsPanelRoot(document.body)).toBe(pane.shadowRoot);
		expect(
			commentsPanelRoot(document.body)!.querySelector('[data-comment-id="c1"]'),
		).not.toBeNull();
	});

	it('keeps an unposted comment across a close and a reopen', () => {
		const drafts = createPptxCommentDrafts();
		const { model } = liveModel(view([], { draftKey: 's1' }));
		const first = openCommentsPanel(document, document.body, t, model, {
			applyComments: vi.fn(),
			drafts,
		}).shadowRoot!;
		type(first.querySelector<HTMLTextAreaElement>('textarea.new')!, 'Half a thought');
		first.querySelector<HTMLButtonElement>('button.close')!.click();

		const again = openCommentsPanel(document, document.body, t, model, {
			applyComments: vi.fn(),
			drafts,
		}).shadowRoot!;
		expect(again.querySelector<HTMLTextAreaElement>('textarea.new')!.value).toBe('Half a thought');
	});

	it('selects the element of a picked thread', () => {
		const selectThread = vi.fn();
		const { model } = liveModel(
			view([{ id: 'c1', text: 'On the title', author: 'Alice', elementId: 'shape-1' }]),
		);
		const root = openCommentsPanel(document, document.body, t, model, {
			applyComments: vi.fn(),
			selectThread,
		}).shadowRoot!;
		root.querySelector<HTMLElement>('.thread .text')!.click();
		expect(selectThread).toHaveBeenCalledWith('c1', 'shape-1');
	});
});

describe('createCommentsPane', () => {
	it('redraws nothing for a view equal to the last, field by field', () => {
		const pane = createCommentsPane(document, t, { applyComments: vi.fn() });
		const comments = [{ id: 'c1', text: 'Here', author: 'Alice' }];
		pane.update(view(comments));
		const threads = pane.el.threads;
		pane.update(view(comments));
		expect(pane.el.threads).toBe(threads);
		pane.update(view(comments, { editable: false }));
		expect(pane.el.readOnly).toBeTruthy();
	});
});

describe('combineCommentMentionAuthors', () => {
	it('maps legacy commentAuthors.xml authors into the modern shape', () => {
		const combined = combineCommentMentionAuthors(
			[{ id: 'p1', name: 'Modern Author', userId: 'u1', providerId: 'prov' }],
			[{ id: '0', name: 'Legacy Author', initials: 'LA', lastIdx: 1, clrIdx: 0 }],
		);
		expect(combined).toStrictEqual([
			{ id: 'p1', name: 'Modern Author', userId: 'u1', providerId: 'prov' },
			{ id: '0', name: 'Legacy Author', userId: '', providerId: '' },
		]);
	});

	it('does not duplicate an id present in both lists', () => {
		const combined = combineCommentMentionAuthors(
			[{ id: '0', name: 'Modern Wins', userId: 'u1', providerId: 'prov' }],
			[{ id: '0', name: 'Legacy Loses', initials: 'LL', lastIdx: 1, clrIdx: 0 }],
		);
		expect(combined).toHaveLength(1);
		expect(combined[0]?.name).toBe('Modern Wins');
	});

	it('returns the same list while both inputs are the same arrays', () => {
		const modern = [{ id: 'p1', name: 'Modern', userId: 'u1', providerId: 'prov' }];
		const legacy = [{ id: '0', name: 'Legacy', initials: 'L', lastIdx: 1, clrIdx: 0 }];
		const first = combineCommentMentionAuthors(modern, legacy);
		expect(combineCommentMentionAuthors(modern, legacy)).toBe(first);
		expect(combineCommentMentionAuthors([...modern], legacy)).not.toBe(first);
	});
});
