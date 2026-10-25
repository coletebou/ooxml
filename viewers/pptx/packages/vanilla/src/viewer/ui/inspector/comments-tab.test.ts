import type { PptxComment, PptxElement } from 'pptx-viewer-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTranslator } from '../../i18n';
import type { CommentsPaneView } from '../comments-pane';
import { createCommentsTab } from './comments-tab';
import type { InspectorDeckState } from './types';

const t = createTranslator();
afterEach(() => document.body.replaceChildren());

const SHAPE = { id: 'shape-1', type: 'shape', name: 'Title' } as unknown as PptxElement;
const ELEMENTS = [SHAPE];
const ALICE = { id: 'a1', name: 'Alice', userId: '', providerId: '' };
const AUTHORS = [ALICE];

function mount() {
	const handlers = { applyComments: vi.fn(), selectElement: vi.fn() };
	const tab = createCommentsTab(document, t, handlers);
	document.body.append(tab.el);
	const show = (comments: PptxComment[], extra: Partial<CommentsPaneView> = {}) =>
		tab.update({
			commentsView: {
				comments,
				editable: true,
				authorName: 'Ada',
				authors: AUTHORS,
				elements: ELEMENTS,
				...extra,
			},
		} as unknown as InspectorDeckState);
	const root = () => tab.el.querySelector('pptx-ui-comments-pane')!.shadowRoot!;
	const button = (label: string) =>
		[...root().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;
	const written = (call = 0) => handlers.applyComments.mock.calls[call]![0] as PptxComment[];
	return { handlers, show, root, button, written };
}

/** Type into a box with the caret at the end, then pick the first person offered. */
function typeAndPick(box: HTMLTextAreaElement, value: string, root: ShadowRoot): void {
	box.value = value;
	box.setSelectionRange(value.length, value.length);
	box.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
	root.querySelector<HTMLElement>('[role="option"]')!.click();
}

const covered = (comment: PptxComment) =>
	(comment.mentions ?? []).map((m) => comment.text.slice(m.startIndex, m.startIndex + m.length));

describe('inspector comments tab', () => {
	it('shows the slide threads in the shared pane, under the tab name only', () => {
		const { show, root } = mount();
		show([{ id: 'c1', text: 'Parent', author: 'Ada', replies: [{ id: 'r1', text: 'Re' }] }]);
		expect(root().querySelectorAll('[data-comment-id]')).toHaveLength(2);
		expect(root().querySelector('h2')).toBeNull();
	});

	it('writes a new comment and a reply with their mentions on the trimmed text', () => {
		const { show, root, button, written } = mount();
		show([{ id: 'c1', text: 'Parent', author: 'Ada' }]);

		typeAndPick(root().querySelector<HTMLTextAreaElement>('textarea.new')!, '  hi @al', root());
		button(t('pptx.comments.addComment')).click();
		const added = written(0).at(-1)!;
		expect(added.text).toBe('hi @Alice');
		expect(covered(added)).toStrictEqual(['@Alice']);

		typeAndPick(
			root().querySelector<HTMLTextAreaElement>('textarea.reply-box')!,
			' ok @al',
			root(),
		);
		button(t('pptx.comments.reply')).click();
		const reply = written(1)[0]!.replies!.at(-1)!;
		expect(reply.text).toBe('ok @Alice');
		expect(covered(reply)).toStrictEqual(['@Alice']);
	});

	it("edits the current author's comment in place as one comment list", () => {
		const { show, root, button, written } = mount();
		show([{ id: 'c1', text: 'Original', author: 'Ada' }]);
		button(t('pptx.comments.edit')).click();
		root().querySelector<HTMLTextAreaElement>('textarea.edit-box')!.value = 'Rewritten';
		button(t('pptx.comments.save')).click();
		expect(written(0)[0]).toMatchObject({ id: 'c1', text: 'Rewritten' });
	});

	it('offers its controls disabled when the deck is read only', () => {
		const { show, root } = mount();
		show([{ id: 'c1', text: 'Parent', author: 'Ada' }], { editable: false });
		expect(root().querySelector<HTMLTextAreaElement>('textarea.new')!.disabled).toBeTruthy();
	});

	it('selects the element a picked thread is on, and nothing for one on a deleted element', () => {
		const { handlers, show, root } = mount();
		show([
			{ id: 'c1', text: 'On the title', author: 'Ada', elementId: 'shape-1' },
			{ id: 'c2', text: 'On a deleted one', author: 'Ada', elementId: 'gone' },
		]);
		const texts = root().querySelectorAll<HTMLElement>('.thread .text');
		texts[0]!.click();
		texts[1]!.click();
		expect(handlers.selectElement.mock.calls).toStrictEqual([['shape-1']]);
	});
});
