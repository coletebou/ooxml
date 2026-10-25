import type { PptxElement, PptxSlide } from 'pptx-viewer-core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';

import { EditorState } from '../../../editor/editor-state.svelte';
import ReviewCommentsPanel from './ReviewCommentsPanel.svelte';

/**
 * The panel is the shared comments pane (`pptx-ui-comments-pane`) over EditorState: these drive
 * the pane's own boxes and buttons, inside its shadow root, and read what reached the editor.
 */
let cleanup: (() => void) | undefined;

afterEach(() => {
	cleanup?.();
	cleanup = undefined;
});

const SHAPE = { id: 'shape-1', type: 'shape', name: 'Title' } as unknown as PptxElement;

function createEditor(slide: Partial<PptxSlide> = {}, hostAuthor?: string): EditorState {
	const editor = new EditorState({
		getCurrent: () => 0,
		getHandler: () => null,
		...(hostAuthor ? { getAuthorName: () => hostAuthor } : {}),
	});
	editor.editable = true;
	editor.setSlides([{ id: 'slide-1', elements: [], ...slide } as PptxSlide]);
	return editor;
}

function mountPanel(editor: EditorState, embedded?: boolean) {
	const target = document.createElement('div');
	document.body.append(target);
	const instance = mount(ReviewCommentsPanel, { target, props: { editor, embedded } });
	flushSync();
	cleanup = () => {
		unmount(instance);
		target.remove();
	};
	const root = () => target.querySelector('pptx-ui-comments-pane')!.shadowRoot!;
	const button = (label: string) =>
		[...root().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;
	const box = (kind: string) => root().querySelector<HTMLTextAreaElement>(`textarea.${kind}`)!;
	return { root, button, box };
}

/** Type into a box with the caret at the end, as the browser reports it. */
function type(box: HTMLTextAreaElement, value: string): void {
	box.value = value;
	box.setSelectionRange(value.length, value.length);
	box.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

describe('reviewCommentsPanel', () => {
	it('keeps an unposted comment across an unmount, per slide', () => {
		let current = $state(0);
		const editor = new EditorState({ getCurrent: () => current, getHandler: () => null });
		editor.editable = true;
		editor.setSlides([
			{ id: 'slide-1', elements: [] },
			{ id: 'slide-2', elements: [] },
		] as unknown as PptxSlide[]);
		const first = mountPanel(editor);
		type(first.box('new'), 'Half a thought');
		cleanup?.();

		const back = mountPanel(editor);
		expect(back.box('new').value).toBe('Half a thought');
		current = 1;
		flushSync();
		expect(back.box('new').value).toBe('');
		current = 0;
		flushSync();
		expect(back.box('new').value).toBe('Half a thought');
	});

	it('adds, resolves and deletes active-slide comments through editor history', () => {
		const editor = createEditor();
		const { button, box, root } = mountPanel(editor);

		type(box('new'), 'Check the opening slide');
		button('Add Comment').click();
		flushSync();
		expect(editor.slides[0]?.comments?.[0]?.text).toBe('Check the opening slide');
		expect(root().textContent).toContain('Check the opening slide');

		button('Resolve').click();
		flushSync();
		expect(editor.slides[0]?.comments?.[0]?.resolved).toBeTruthy();
		button('Delete').click();
		flushSync();
		expect(editor.slides[0]?.comments).toStrictEqual([]);

		editor.undo();
		flushSync();
		expect(editor.slides[0]?.comments?.[0]?.resolved).toBeTruthy();
	});

	it('appends a reply to its thread', () => {
		const editor = createEditor({
			comments: [{ id: 'c1', text: 'Parent comment', author: 'Alice' }],
		});
		const { button, box, root } = mountPanel(editor);
		type(box('reply-box'), 'A threaded reply');
		button('Reply').click();
		flushSync();

		expect(editor.slides[0]?.comments?.[0]?.replies?.[0]).toMatchObject({
			text: 'A threaded reply',
			threadId: 'c1',
			parentId: 'c1',
		});
		expect(root().querySelector('[data-thread-id="c1"]')?.textContent).toContain(
			'A threaded reply',
		);
	});

	it('stores a picked mention on its text through the trim', () => {
		const editor = createEditor();
		editor.modernCommentAuthors = [{ id: 'a1', name: 'Alice', userId: 'u1', providerId: 'p1' }];
		const { button, box, root } = mountPanel(editor);
		type(box('new'), '  hey @al');
		root().querySelector<HTMLElement>('[role="option"]')!.click();
		button('Add Comment').click();
		flushSync();

		const saved = editor.slides[0]?.comments?.[0];
		const mention = saved?.mentions?.[0];
		expect(saved?.text).toBe('hey @Alice');
		expect(mention).toMatchObject({ personId: 'a1', authorName: 'Alice' });
		expect(saved?.text.slice(mention!.startIndex, mention!.startIndex + mention!.length)).toBe(
			'@Alice',
		);
	});

	it('authors comments as the host authorName prop, on the selected element', () => {
		const editor = createEditor({ elements: [SHAPE] }, 'Dana Host');
		editor.select('shape-1');
		const { button, box } = mountPanel(editor);
		type(box('new'), 'Written by the host identity');
		button('Add Comment').click();
		flushSync();
		expect(editor.slides[0]?.comments?.[0]).toMatchObject({
			author: 'Dana Host',
			elementId: 'shape-1',
		});
	});

	it('selects the element of a picked thread', () => {
		const editor = createEditor({
			elements: [SHAPE],
			comments: [{ id: 'c1', text: 'On the title', author: 'Alice', elementId: 'shape-1' }],
		});
		const { root } = mountPanel(editor);
		root().querySelector<HTMLElement>('.thread .text')!.click();
		flushSync();
		expect(editor.selectedElementId).toBe('shape-1');
	});

	it('draws its own heading by default and none when embedded, keeping the composer', () => {
		expect(mountPanel(createEditor()).root().querySelector('h2')).not.toBeNull();
		cleanup?.();
		const embedded = mountPanel(createEditor(), true);
		expect(embedded.root().querySelector('h2')).toBeNull();
		expect(embedded.box('new')).not.toBeNull();
	});
});
