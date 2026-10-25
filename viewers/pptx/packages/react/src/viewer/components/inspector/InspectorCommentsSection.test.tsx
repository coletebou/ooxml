// @vitest-environment happy-dom
/**
 * The inspector's Comments tab is the shared comments pane (`pptx-ui-comments-pane`): these drive
 * the pane's own boxes and buttons, inside its shadow root, and read what the section reports.
 */
import { createPptxCommentDrafts } from 'ooxml-ui/pptx';
import { translationsEn } from 'ooxml-ui/pptx/i18n';
import type { PptxComment, PptxElement, PptxModernCommentAuthor } from 'pptx-viewer-core';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InspectorCommentsSection } from './InspectorCommentsSection';
import type { InspectorCommentsSectionProps } from './InspectorCommentsSection';

vi.mock<typeof import('../../i18n/use-translation')>(import('../../i18n/use-translation'), () => ({
	useTranslation: () => ({ t: (key: string) => translationsEn[key] ?? key, locale: 'en' }),
}));

const AUTHORS: PptxModernCommentAuthor[] = [
	{ id: '{A}', name: 'Alice', userId: '', providerId: '' },
];
const SHAPE = { id: 'shape-1', type: 'shape', name: 'Title' } as unknown as PptxElement;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement('div');
	document.body.append(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

function renderSection(props: Partial<InspectorCommentsSectionProps>) {
	const onCommentsChange = vi.fn<(next: PptxComment[]) => void>();
	const onSelectElement = vi.fn<(id: string | null) => void>();
	const draw = (next: Partial<InspectorCommentsSectionProps>) =>
		act(() =>
			root.render(
				<InspectorCommentsSection
					comments={[]}
					canEdit
					authorName='Ada'
					commentAuthors={[]}
					elements={[]}
					selectedElementId={null}
					onCommentsChange={onCommentsChange}
					onSelectElement={onSelectElement}
					{...props}
					{...next}
				/>,
			),
		);
	draw({});
	const pane = () => container.querySelector<HTMLElement>('pptx-ui-comments-pane')!;
	const shadow = () => pane().shadowRoot!;
	const button = (label: string) =>
		[...shadow().querySelectorAll<HTMLButtonElement>('button')].find(
			(candidate) => candidate.textContent === label,
		)!;
	const lists = () => onCommentsChange.mock.calls.map(([next]) => next);
	return { draw, pane, shadow, button, lists, onSelectElement };
}

/** Type into a box with the caret at the end, as the browser reports it. */
function type(box: HTMLTextAreaElement, value: string): void {
	box.value = value;
	box.setSelectionRange(value.length, value.length);
	box.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

describe('inspectorCommentsSection on the shared pane', () => {
	it('reports a new comment on the selected element, its mention on the trimmed text', () => {
		const { shadow, button, lists } = renderSection({
			commentAuthors: AUTHORS,
			elements: [SHAPE],
			selectedElementId: 'shape-1',
		});
		type(shadow().querySelector<HTMLTextAreaElement>('textarea.new')!, '  hey @al');
		shadow().querySelector<HTMLElement>('[role="option"]')!.click();
		button('Add Comment').click();

		const added = lists()[0]!.at(-1)!;
		expect(added).toMatchObject({ text: 'hey @Alice', author: 'Ada', elementId: 'shape-1' });
		const [mention] = added.mentions!;
		expect(added.text.slice(mention!.startIndex, mention!.startIndex + mention!.length)).toBe(
			'@Alice',
		);
	});

	it('follows its props, reports a reply, a resolve and an edit, and selects a picked thread', () => {
		const comments: PptxComment[] = [
			{ id: 'c1', text: 'On the title', author: 'Ada', elementId: 'shape-1' },
		];
		const { draw, shadow, button, lists, onSelectElement } = renderSection({
			comments,
			elements: [SHAPE],
		});
		expect(shadow().querySelectorAll('[data-thread-id]')).toHaveLength(1);

		type(shadow().querySelector<HTMLTextAreaElement>('textarea.reply-box')!, 'Answer');
		button('Reply').click();
		expect(lists()[0]![0]!.replies!.map((reply) => reply.text)).toStrictEqual(['Answer']);
		button('Resolve').click();
		expect(lists()[1]![0]!.resolved).toBeTruthy();
		// Edit is offered on the user's own comments (Office's rule).
		button('Edit').click();
		type(shadow().querySelector<HTMLTextAreaElement>('textarea.edit-box')!, 'On the heading');
		button('Save').click();
		expect(lists()[2]![0]!.text).toBe('On the heading');

		shadow().querySelector<HTMLElement>('.thread .text')!.click();
		expect(onSelectElement).toHaveBeenCalledExactlyOnceWith('shape-1');

		draw({ comments: [...comments, { id: 'c2', text: 'More', author: 'Grace' }] });
		expect(shadow().querySelectorAll('[data-thread-id]')).toHaveLength(2);
	});

	it('selects nothing for a thread whose element left the slide', () => {
		const { shadow, onSelectElement } = renderSection({
			comments: [{ id: 'c1', text: 'Gone', author: 'Ada', elementId: 'shape-9' }],
			elements: [SHAPE],
		});
		shadow().querySelector<HTMLElement>('.thread .text')!.click();
		expect(onSelectElement).not.toHaveBeenCalled();
	});

	it('drops its heading inside the titled tab and writes nothing while not editable', () => {
		const { pane, shadow, lists } = renderSection({
			comments: [{ id: 'c1', text: 'Here', author: 'Ada' }],
			canEdit: false,
		});
		expect(shadow().querySelector('h2')).toBeNull();
		expect(shadow().querySelector<HTMLTextAreaElement>('textarea.new')!.disabled).toBeTruthy();
		pane().dispatchEvent(new CustomEvent('comment-add', { detail: { text: 'x' } }));
		expect(lists()).toStrictEqual([]);
	});

	it('keeps an unposted comment across an unmount, per slide', () => {
		const drafts = createPptxCommentDrafts();
		const first = renderSection({ drafts, draftKey: 'slide-1' });
		type(first.shadow().querySelector<HTMLTextAreaElement>('textarea.new')!, 'Half a thought');
		act(() => root.render(<div />));

		const back = renderSection({ drafts, draftKey: 'slide-1' });
		const box = () => back.shadow().querySelector<HTMLTextAreaElement>('textarea.new')!;
		expect(box().value).toBe('Half a thought');
		back.draw({ draftKey: 'slide-2' });
		expect(box().value).toBe('');
		back.draw({ draftKey: 'slide-1' });
		expect(box().value).toBe('Half a thought');
	});

	it('listens no more once unmounted', () => {
		const { pane, lists } = renderSection({});
		const element = pane();
		act(() => root.render(<div />));
		element.dispatchEvent(new CustomEvent('comment-add', { detail: { text: 'late' } }));
		expect(lists()).toStrictEqual([]);
	});
});
