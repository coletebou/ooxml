// @vitest-environment jsdom
import type { PptxComment } from 'ooxml-core/pptx';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { OfficeUiCommentsPane } from '../../comments/comments-pane';
import { definePptxCommentsPane } from '../web-components/comments-pane';
import { createPptxCommentDrafts, type PptxCommentDrafts } from './comment-drafts';
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

function mount(overrides: Partial<PptxCommentsPaneInput> = {}, drafts?: PptxCommentDrafts) {
	const element = document.createElement('pptx-ui-comments-pane') as OfficeUiCommentsPane;
	document.body.append(element);
	const host = {
		applyComments: vi.fn(),
		selectThread: vi.fn(),
		close: vi.fn(),
		...(drafts ? { drafts } : {}),
	};
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

	it('keeps unposted boxes per slide in the drafts store across panes', () => {
		const drafts = createPptxCommentDrafts();
		const first = mount({ draftKey: 'slide-1' }, drafts);
		const newBox = (root: ShadowRoot) => root.querySelector<HTMLTextAreaElement>('textarea.new')!;
		newBox(first.root).value = 'Half a thought';
		first.root.querySelector<HTMLTextAreaElement>('textarea.reply-box')!.value = 'Half a reply';
		first.binding.dispose();
		first.element.remove();
		expect(drafts.get('slide-1')).toStrictEqual({
			comment: { text: 'Half a thought' },
			replies: { c1: { text: 'Half a reply' } },
		});

		const next = mount({ draftKey: 'slide-1' }, drafts);
		expect(newBox(next.root).value).toBe('Half a thought');
		expect(next.root.querySelector<HTMLTextAreaElement>('textarea.reply-box')!.value).toBe(
			'Half a reply',
		);

		// Another slide: its own boxes, and this slide's come back on return.
		next.binding.sync({ comments: [], editable: true, authorName: 'Ada', t, draftKey: 'slide-2' });
		expect(newBox(next.root).value).toBe('');
		newBox(next.root).value = 'For slide two';
		next.binding.sync({
			comments: COMMENTS,
			editable: true,
			authorName: 'Ada',
			t,
			draftKey: 'slide-1',
		});
		expect(newBox(next.root).value).toBe('Half a thought');
		expect(drafts.get('slide-2')).toStrictEqual({ comment: { text: 'For slide two' } });
	});

	it('writes back only what a pane changed, so panes sharing a store keep each other drafts', () => {
		const drafts = createPptxCommentDrafts();
		const newBox = (root: ShadowRoot) => root.querySelector<HTMLTextAreaElement>('textarea.new')!;
		// Two panes on one slide: the one typed in keeps its draft past the untouched one.
		const typed = mount({ draftKey: 'slide-1' }, drafts);
		const idle = mount({ draftKey: 'slide-1' }, drafts);
		newBox(typed.root).value = 'Mine';
		typed.binding.dispose();
		idle.binding.dispose();
		expect(drafts.get('slide-1')).toStrictEqual({ comment: { text: 'Mine' } });

		// Both take the draft back; posting it from one does not leave the other to restore it.
		const poster = mount({ draftKey: 'slide-1' }, drafts);
		const other = mount({ draftKey: 'slide-1' }, drafts);
		expect(newBox(other.root).value).toBe('Mine');
		poster.button('[pptx.comments.addComment]').click();
		poster.binding.dispose();
		other.binding.dispose();
		expect(drafts.has('slide-1')).toBeFalsy();
	});

	it('merges the boxes each pane changed, so two panes on one slide keep both drafts', () => {
		const drafts = createPptxCommentDrafts();
		const first = mount({ draftKey: 'slide-1' }, drafts);
		const second = mount({ draftKey: 'slide-1' }, drafts);
		first.root.querySelector<HTMLTextAreaElement>('textarea.new')!.value = 'A new one';
		second.root.querySelector<HTMLTextAreaElement>('textarea.reply-box')!.value = 'A reply';
		first.binding.dispose();
		second.binding.dispose();
		expect(drafts.get('slide-1')).toStrictEqual({
			comment: { text: 'A new one' },
			replies: { c1: { text: 'A reply' } },
		});
	});

	it('drops the boxes of the last document once the store is cleared for a new one', () => {
		const drafts = createPptxCommentDrafts();
		const { root, binding } = mount({ draftKey: 'slide-1' }, drafts);
		const box = root.querySelector<HTMLTextAreaElement>('textarea.new')!;
		box.value = 'From the old deck';
		drafts.clear();
		binding.sync({ comments: [], editable: true, authorName: 'Ada', t, draftKey: 'slide-1' });
		expect(box.value).toBe('');
		box.value = 'From the new deck';
		binding.dispose();
		expect(drafts.get('slide-1')).toStrictEqual({ comment: { text: 'From the new deck' } });

		const stale = mount({ draftKey: 'slide-1' }, drafts);
		stale.root.querySelector<HTMLTextAreaElement>('textarea.new')!.value = 'Typed, then a new deck';
		drafts.clear();
		stale.binding.dispose();
		expect(drafts.size).toBe(0);
	});

	it('forgets a posted draft at once, so a pane opened after the post starts empty', () => {
		const drafts = createPptxCommentDrafts();
		drafts.set('slide-1', { comment: { text: 'Ready' }, replies: { c1: { text: 'Kept' } } });
		const { button } = mount({ draftKey: 'slide-1' }, drafts);
		button('[pptx.comments.addComment]').click();
		expect(drafts.get('slide-1')).toStrictEqual({ replies: { c1: { text: 'Kept' } } });
		const later = mount({ draftKey: 'slide-1' }, drafts);
		expect(later.root.querySelector<HTMLTextAreaElement>('textarea.new')!.value).toBe('');
	});

	it('clears a posted draft from the other open panes on the slide, keeping what they typed', () => {
		const drafts = createPptxCommentDrafts();
		drafts.set('slide-1', { comment: { text: 'Ready' } });
		const poster = mount({ draftKey: 'slide-1' }, drafts);
		const other = mount({ draftKey: 'slide-1' }, drafts);
		const reply = other.root.querySelector<HTMLTextAreaElement>('textarea.reply-box')!;
		reply.value = 'Typed here';
		poster.button('[pptx.comments.addComment]').click();
		expect(other.root.querySelector<HTMLTextAreaElement>('textarea.new')!.value).toBe('');
		expect(reply.value).toBe('Typed here');
		other.binding.dispose();
		expect(drafts.get('slide-1')).toStrictEqual({ replies: { c1: { text: 'Typed here' } } });
	});

	it('forgets a posted draft, and leaves the boxes alone without a store', () => {
		const drafts = createPptxCommentDrafts();
		drafts.set('slide-1', { comment: { text: 'Ready' } });
		const { host, binding, button } = mount({ draftKey: 'slide-1' }, drafts);
		button('[pptx.comments.addComment]').click();
		expect((host.applyComments.mock.calls[0]![0] as PptxComment[]).at(-1)!.text).toBe('Ready');
		binding.dispose();
		expect(drafts.has('slide-1')).toBeFalsy();

		const plain = mount({ draftKey: 'slide-1' });
		plain.root.querySelector<HTMLTextAreaElement>('textarea.new')!.value = 'Mine';
		plain.binding.sync({ comments: [], editable: true, authorName: 'Ada', t, draftKey: 'slide-2' });
		expect(plain.root.querySelector<HTMLTextAreaElement>('textarea.new')!.value).toBe('Mine');
	});
});
