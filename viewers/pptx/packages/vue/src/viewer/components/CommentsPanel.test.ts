import { mount } from '@vue/test-utils';
import { createPptxCommentDrafts } from 'ooxml-ui/pptx';
import type { PptxComment, PptxElement, PptxModernCommentAuthor } from 'pptx-viewer-core';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import CommentsPanel from './CommentsPanel.vue';

/**
 * The panel is the shared comments pane (`pptx-ui-comments-pane`): these drive the pane's own
 * boxes and buttons, inside its shadow root, and read what the panel emits.
 */
const AUTHORS: PptxModernCommentAuthor[] = [
	{ id: '{A}', name: 'Alice', userId: '', providerId: '' },
];
const SHAPE = { id: 'shape-1', type: 'shape', name: 'Title' } as unknown as PptxElement;

afterEach(() => document.body.replaceChildren());

function mountPanel(props: Record<string, unknown>) {
	const wrapper = mount(CommentsPanel, {
		props: { comments: [], authorName: 'Ada', ...props },
		attachTo: document.body,
	});
	// The panel's single root is the pane itself.
	const root = () => (wrapper.element as HTMLElement).shadowRoot!;
	const button = (label: string) =>
		[...root().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;
	const lists = () => (wrapper.emitted('change') ?? []).map(([next]) => next as PptxComment[]);
	return { wrapper, root, button, lists };
}

/** Type into a box with the caret at the end, as the browser reports it. */
function type(box: HTMLTextAreaElement, value: string): void {
	box.value = value;
	box.setSelectionRange(value.length, value.length);
	box.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

describe('commentsPanel on the shared pane', () => {
	it('emits a new comment on the selected element, its mention on the trimmed text', () => {
		const { root, button, lists } = mountPanel({
			modernCommentAuthors: AUTHORS,
			elements: [SHAPE],
			selectedElementId: 'shape-1',
		});
		type(root().querySelector<HTMLTextAreaElement>('textarea.new')!, '  hey @al');
		root().querySelector<HTMLElement>('[role="option"]')!.click();
		button('Add Comment').click();

		const added = lists()[0]!.at(-1)!;
		expect(added).toMatchObject({ text: 'hey @Alice', author: 'Ada', elementId: 'shape-1' });
		const [mention] = added.mentions!;
		expect(added.text.slice(mention!.startIndex, mention!.startIndex + mention!.length)).toBe(
			'@Alice',
		);
	});

	it('follows its props, emits a reply and a resolve, and reports a picked thread', async () => {
		const comments: PptxComment[] = [
			{ id: 'c1', text: 'On the title', author: 'Grace', elementId: 'shape-1' },
		];
		const { wrapper, root, button, lists } = mountPanel({ comments, elements: [SHAPE] });
		expect(root().querySelectorAll('[data-thread-id]')).toHaveLength(1);

		type(root().querySelector<HTMLTextAreaElement>('textarea.reply-box')!, 'Answer');
		button('Reply').click();
		expect(lists()[0]![0]!.replies!.map((reply) => reply.text)).toStrictEqual(['Answer']);
		button('Resolve').click();
		expect(lists()[1]![0]!.resolved).toBeTruthy();

		root().querySelector<HTMLElement>('.thread .text')!.click();
		expect(wrapper.emitted('select')).toStrictEqual([[{ commentId: 'c1', elementId: 'shape-1' }]]);

		await wrapper.setProps({ comments: [...comments, { id: 'c2', text: 'More', author: 'Ada' }] });
		await nextTick();
		expect(root().querySelectorAll('[data-thread-id]')).toHaveLength(2);
	});

	it('drops its heading when embedded and writes nothing while not editable', () => {
		const { wrapper, root } = mountPanel({
			comments: [{ id: 'c1', text: 'Here', author: 'Ada' }],
			embedded: true,
			editable: false,
		});
		expect(root().querySelector('h2')).toBeNull();
		expect(root().querySelector<HTMLTextAreaElement>('textarea.new')!.disabled).toBeTruthy();
		wrapper.element.dispatchEvent(new CustomEvent('comment-add', { detail: { text: 'x' } }));
		expect(wrapper.emitted('change')).toBeUndefined();
	});

	it('reports no element for a thread whose element left the slide', () => {
		const { wrapper, root } = mountPanel({
			comments: [{ id: 'c1', text: 'Gone', author: 'Ada', elementId: 'shape-9' }],
			elements: [SHAPE],
		});
		root().querySelector<HTMLElement>('.thread .text')!.click();
		expect(wrapper.emitted('select')).toStrictEqual([[{ commentId: 'c1' }]]);
	});

	it('keeps an unposted comment across an unmount, per slide', async () => {
		const drafts = createPptxCommentDrafts();
		const first = mountPanel({ drafts, draftKey: 'slide-1' });
		type(first.root().querySelector<HTMLTextAreaElement>('textarea.new')!, 'Half a thought');
		first.wrapper.unmount();

		const back = mountPanel({ drafts, draftKey: 'slide-1' });
		const box = () => back.root().querySelector<HTMLTextAreaElement>('textarea.new')!;
		expect(box().value).toBe('Half a thought');
		await back.wrapper.setProps({ draftKey: 'slide-2' });
		expect(box().value).toBe('');
		await back.wrapper.setProps({ draftKey: 'slide-1' });
		expect(box().value).toBe('Half a thought');
	});
});
