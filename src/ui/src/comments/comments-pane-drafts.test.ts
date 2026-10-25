// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineCommentsPane, type OfficeUiCommentsPane } from './comments-pane';
import type { OfficeMentionCandidate } from './mentions';
import type { OfficeCommentThread } from './types';

beforeAll(() => defineCommentsPane());
afterEach(() => document.body.replaceChildren());

const PEOPLE: OfficeMentionCandidate[] = [{ id: 'p2', name: 'Grace Hopper' }];
const THREADS: OfficeCommentThread[] = [
	{ id: 't1', resolved: false, comments: [{ id: 'c1', author: 'Ada', text: 'First' }] },
	{ id: 't2', resolved: false, comments: [{ id: 'c2', author: 'Ada', text: 'Second' }] },
];

function pane(): OfficeUiCommentsPane {
	const el = document.createElement('office-ui-comments-pane') as OfficeUiCommentsPane;
	el.threads = THREADS;
	el.currentAuthor = 'Ada';
	el.mentionCandidates = PEOPLE;
	document.body.append(el);
	return el;
}
const root = (el: OfficeUiCommentsPane) => el.shadowRoot!;
const newBox = (el: OfficeUiCommentsPane) =>
	root(el).querySelector<HTMLTextAreaElement>('textarea.new')!;
const replyBox = (el: OfficeUiCommentsPane, thread: string) =>
	root(el).querySelector<HTMLTextAreaElement>(`[data-thread-id="${thread}"] textarea.reply-box`)!;
const editBox = (el: OfficeUiCommentsPane) =>
	root(el).querySelector<HTMLTextAreaElement>('textarea.edit-box');
const button = (el: OfficeUiCommentsPane, label: string, scope: ParentNode = root(el)) =>
	[...scope.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;
function type(target: HTMLTextAreaElement, value: string) {
	target.value = value;
	target.setSelectionRange(value.length, value.length);
	target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}
/** Type `before`, pick Grace from the list, then type `after`. */
function typeWithMention(el: OfficeUiCommentsPane, target: HTMLTextAreaElement, before: string) {
	type(target, before);
	root(el).querySelector<HTMLElement>('[role="option"]')!.click();
	type(target, `${target.value}soon`);
}

describe('comments pane drafts', () => {
	it('reads what the boxes hold, mentions included, leaving empty boxes out', () => {
		const el = pane();
		expect(el.drafts()).toStrictEqual({});

		typeWithMention(el, newBox(el), '  ask @gr');
		type(replyBox(el, 't2'), 'A reply');
		button(el, 'Edit').click();
		type(editBox(el)!, 'First, edited');

		expect(el.drafts()).toStrictEqual({
			comment: {
				text: '  ask @Grace Hopper soon',
				mentions: [{ start: 6, length: 13, id: 'p2', name: 'Grace Hopper' }],
			},
			replies: { t2: { text: 'A reply' } },
			edit: { commentId: 'c1', text: 'First, edited', start: { text: 'First' } },
		});
	});

	it('puts drafts back into a new pane, which then posts them with their mentions', () => {
		const first = pane();
		typeWithMention(first, newBox(first), 'ask @gr');
		type(replyBox(first, 't1'), 'Kept reply');
		const drafts = first.drafts();
		first.remove();

		const next = pane();
		next.restoreDrafts(drafts);
		expect(newBox(next).value).toBe('ask @Grace Hopper soon');
		expect(replyBox(next, 't1').value).toBe('Kept reply');
		expect(replyBox(next, 't2').value).toBe('');

		const added = vi.fn<(event: Event) => void>();
		next.addEventListener('comment-add', added);
		button(next, 'Add comment').click();
		expect((added.mock.calls[0]![0] as CustomEvent).detail).toStrictEqual({
			text: 'ask @Grace Hopper soon',
			mentions: [{ start: 4, length: 13, id: 'p2', name: 'Grace Hopper' }],
		});
	});

	it('reopens an edit that was under way, and ends one when the drafts have none', () => {
		const el = pane();
		el.restoreDrafts({ edit: { commentId: 'c2', text: 'Second, edited' } });
		expect(editBox(el)!.value).toBe('Second, edited');
		const edited = vi.fn<(event: Event) => void>();
		el.addEventListener('comment-edit', edited);
		button(el, 'Save').click();
		expect((edited.mock.calls[0]![0] as CustomEvent).detail).toMatchObject({
			commentId: 'c2',
			text: 'Second, edited',
		});

		button(el, 'Edit').click();
		type(newBox(el), 'Gone');
		el.restoreDrafts(null);
		expect(editBox(el)).toBeNull();
		expect(newBox(el).value).toBe('');
		expect(el.drafts()).toStrictEqual({});
	});

	it('keeps an edit under way when the comment changes underneath it', () => {
		const el = pane();
		button(el, 'Edit').click();
		type(editBox(el)!, 'First, mine');
		el.threads = [
			{ ...THREADS[0]!, comments: [{ id: 'c1', author: 'Ada', text: 'First, theirs' }] },
			THREADS[1]!,
		];
		expect(editBox(el)!.value).toBe('First, mine');
	});

	it('saves nothing for an untouched edit whose comment changed underneath it', () => {
		const el = pane();
		const edited = vi.fn<(event: Event) => void>();
		el.addEventListener('comment-edit', edited);
		button(el, 'Edit').click();
		el.threads = [
			{ ...THREADS[0]!, comments: [{ id: 'c1', author: 'Ada', text: 'First, theirs' }] },
			THREADS[1]!,
		];
		button(el, 'Save').click();
		expect(edited).not.toHaveBeenCalled();
	});

	it('keeps what was typed into an edit through a read-only spell', () => {
		const el = pane();
		button(el, 'Edit').click();
		type(editBox(el)!, 'First, mine');
		el.readOnly = true;
		el.readOnly = false;
		expect(editBox(el)!.value).toBe('First, mine');
	});

	it('keeps an edit typed before a read-only spell in its drafts, and puts it back while locked', () => {
		const first = pane();
		button(first, 'Edit').click();
		type(editBox(first)!, 'First, mine');
		first.readOnly = true;
		const drafts = first.drafts();
		expect(drafts.edit).toMatchObject({ commentId: 'c1', text: 'First, mine' });
		first.remove();

		const next = pane();
		next.readOnly = true;
		next.restoreDrafts(drafts);
		next.readOnly = false;
		expect(editBox(next)!.value).toBe('First, mine');
	});

	it('takes another pane edit text for the same locked edit', () => {
		const el = pane();
		el.restoreDrafts({ edit: { commentId: 'c1', text: 'Original' } });
		el.readOnly = true;
		el.restoreDrafts({ edit: { commentId: 'c1', text: 'Updated' } });
		el.readOnly = false;
		expect(editBox(el)!.value).toBe('Updated');
	});

	it('takes the start of another pane edit of the same comment along with its text', () => {
		const el = pane();
		el.restoreDrafts({ edit: { commentId: 'c1', text: 'First', start: { text: 'First' } } });
		el.restoreDrafts({
			edit: { commentId: 'c1', text: 'First', start: { text: 'First, theirs' } },
		});
		const edited = vi.fn<(event: Event) => void>();
		el.addEventListener('comment-edit', edited);
		button(el, 'Save').click();
		expect((edited.mock.calls[0]![0] as CustomEvent).detail).toMatchObject({ text: 'First' });
	});

	it('keeps an edit its mentions when the comment loses them underneath it', () => {
		const el = pane();
		el.mentionCandidates = [];
		const grace = { start: 4, length: 13, id: 'p2', name: 'Grace Hopper' };
		el.threads = [
			{
				...THREADS[0]!,
				comments: [{ id: 'c1', author: 'Ada', text: 'Ask @Grace Hopper', mentions: [grace] }],
			},
			THREADS[1]!,
		];
		button(el, 'Edit').click();
		el.threads = [
			{ ...THREADS[0]!, comments: [{ id: 'c1', author: 'Ada', text: 'Ask her' }] },
			THREADS[1]!,
		];
		type(editBox(el)!, 'Ask @Grace Hopper now');
		const edited = vi.fn<(event: Event) => void>();
		el.addEventListener('comment-edit', edited);
		button(el, 'Save').click();
		expect((edited.mock.calls[0]![0] as CustomEvent).detail).toMatchObject({
			text: 'Ask @Grace Hopper now',
			mentions: [grace],
		});
	});

	it('carries where an edit started with its draft, so an untouched one saves nothing later', () => {
		const first = pane();
		button(first, 'Edit').click();
		const drafts = first.drafts();
		expect(drafts.edit).toStrictEqual({ commentId: 'c1', text: 'First', start: { text: 'First' } });
		first.remove();

		const next = pane();
		next.threads = [
			{ ...THREADS[0]!, comments: [{ id: 'c1', author: 'Ada', text: 'First, theirs' }] },
			THREADS[1]!,
		];
		next.restoreDrafts(drafts);
		const edited = vi.fn<(event: Event) => void>();
		next.addEventListener('comment-edit', edited);
		button(next, 'Save').click();
		expect(edited).not.toHaveBeenCalled();
	});

	it('skips a draft for a thread or comment the pane does not show', () => {
		const el = pane();
		el.restoreDrafts({
			replies: { gone: { text: 'Lost thread' } },
			edit: { commentId: 'c9', text: 'Lost comment' },
		});
		expect(editBox(el)).toBeNull();
		expect(el.drafts()).toStrictEqual({});
	});
});
