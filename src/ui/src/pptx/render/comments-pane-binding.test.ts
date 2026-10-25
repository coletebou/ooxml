// @vitest-environment jsdom
import type { PptxComment } from 'ooxml-core/pptx';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { OfficeUiCommentsPane } from '../../comments/comments-pane';
import { definePptxCommentsPane } from '../web-components/comments-pane';
import { createPptxCommentsPaneBinding, type PptxCommentsPaneInput } from './comments-pane-binding';

beforeAll(() => definePptxCommentsPane(customElements));
afterEach(() => document.body.replaceChildren());

const COMMENTS: PptxComment[] = [
	{
		id: 'c1',
		text: 'First',
		author: 'Ada',
		elementId: 'shape-1',
		replies: [{ id: 'r1', text: 'Re' }],
	},
	{ id: 'c2', text: 'Second', author: 'Grace', resolved: true },
];
const t = (key: string) => `[${key}]`;

function mount(overrides: Partial<PptxCommentsPaneInput> = {}) {
	const element = document.createElement('pptx-ui-comments-pane') as OfficeUiCommentsPane;
	document.body.append(element);
	const host = { applyComments: vi.fn(), selectThread: vi.fn(), close: vi.fn() };
	const binding = createPptxCommentsPaneBinding(element, host);
	binding.sync({ comments: COMMENTS, editable: true, authorName: 'Ada', t, ...overrides });
	const root = element.shadowRoot!;
	const button = (label: string) =>
		[...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;
	return { element, host, binding, root, button };
}

describe('pptx comments pane binding', () => {
	it('draws the slide comments with the pptx strings, people and the current thread', () => {
		const { element, root } = mount({
			activeCommentId: 'r1',
			authors: [{ id: '{G}', name: 'Grace', userId: '', providerId: '' }],
		});
		expect(element.threads.map((thread) => thread.id)).toStrictEqual(['c1', 'c2']);
		expect(element.activeThreadId).toBe('c1');
		expect(element.currentAuthor).toBe('Ada');
		expect(element.mentionCandidates).toStrictEqual([{ id: '{G}', name: 'Grace' }]);
		expect(root.querySelector('textarea.new')!.getAttribute('aria-label')).toBe(
			'[pptx.comments.addPlaceholder]',
		);
		expect(root.querySelectorAll('.pptx-comment-thread')).toHaveLength(2);
	});

	it('writes an add, a reply and a resolve as one comment list each', () => {
		const { host, root, button } = mount({ selectedElementId: 'shape-1' });
		root.querySelector<HTMLTextAreaElement>('textarea.new')!.value = 'New one';
		button('[pptx.comments.addComment]').click();
		const added = host.applyComments.mock.calls[0]![0] as PptxComment[];
		expect(added.at(-1)).toMatchObject({ text: 'New one', author: 'Ada', elementId: 'shape-1' });

		root.querySelector<HTMLTextAreaElement>('textarea.reply-box')!.value = 'Answer';
		button('[pptx.comments.reply]').click();
		const replied = host.applyComments.mock.calls[1]![0] as PptxComment[];
		expect(replied[0]!.replies!.map((reply) => reply.text)).toStrictEqual(['Re', 'Answer']);

		button('[pptx.comments.resolve]').click();
		expect((host.applyComments.mock.calls[2]![0] as PptxComment[])[0]!.resolved).toBe(true);
	});

	it('drops its heading inside a titled surface, keeping the other strings', () => {
		const { element, root } = mount({ showHeading: false });
		expect(root.querySelector('h2')).toBeNull();
		expect(element.labels.add).toBe('[pptx.comments.addComment]');
	});

	it('marks a pane inside a titled surface, which frames it, and clears the mark outside one', () => {
		const { element, binding } = mount({ showHeading: false });
		expect(element.hasAttribute('data-pptx-embedded')).toBe(true);
		binding.sync({ comments: COMMENTS, editable: true, authorName: 'Ada', t });
		expect(element.hasAttribute('data-pptx-embedded')).toBe(false);
	});

	it('reports a picked thread with its element, and the close button', () => {
		const { host, root } = mount({ closable: true });
		root.querySelector<HTMLElement>('.thread .text')!.click();
		expect(host.selectThread).toHaveBeenCalledWith('c1', 'shape-1');
		root.querySelector<HTMLButtonElement>('button.close')!.click();
		expect(host.close).toHaveBeenCalledOnce();
	});

	it('keeps the keys it used to move between threads from paging the slides', () => {
		// The viewer root pages slides on the arrows, Home and End; the pane moves between threads.
		const { root } = mount();
		const outside = vi.fn();
		document.body.addEventListener('keydown', outside);
		const press = (target: Element, key: string) =>
			target.dispatchEvent(
				new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true }),
			);
		const card = root.querySelector<HTMLElement>('.thread')!;
		press(card, 'ArrowDown');
		press(root.querySelector<HTMLElement>('.thread')!, 'End');
		expect(outside).not.toHaveBeenCalled();
		// A key the pane leaves alone still reaches the viewer (its own shortcuts).
		press(card, 'F5');
		expect(outside).toHaveBeenCalledOnce();
		document.body.removeEventListener('keydown', outside);
	});

	it('writes nothing when read only, and listens no more once disposed', () => {
		const { element, host, binding, root, button } = mount({ editable: false });
		expect(element.readOnly).toBe(true);
		element.dispatchEvent(new CustomEvent('comment-add', { detail: { text: 'x' } }));
		expect(host.applyComments).not.toHaveBeenCalled();
		binding.sync({ comments: COMMENTS, editable: true, authorName: 'Ada', t });
		binding.dispose();
		root.querySelector<HTMLTextAreaElement>('textarea.new')!.value = 'Late';
		button('[pptx.comments.addComment]').click();
		expect(host.applyComments).not.toHaveBeenCalled();
	});
});
