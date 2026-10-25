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
			edit: { commentId: 'c1', text: 'First, edited' },
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
