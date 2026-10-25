// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineCommentsPane, type OfficeUiCommentsPane } from './comments-pane';
import type { OfficeMentionCandidate } from './mentions';
import type { OfficeCommentThread } from './types';

beforeAll(() => defineCommentsPane());
afterEach(() => document.body.replaceChildren());

const PEOPLE: OfficeMentionCandidate[] = [
	{ id: 'p1', name: 'Ada Lovelace', initials: 'AL' },
	{ id: 'p2', name: 'Grace Hopper', initials: 'GH' },
	{ id: 'p3', name: 'Alan Turing' },
];
const GRACE = { id: 'p2', name: 'Grace Hopper' };
const THREADS: OfficeCommentThread[] = [
	{
		id: 't1',
		resolved: false,
		comments: [
			{
				id: 'c1',
				author: 'Ada Lovelace',
				text: 'Ask @Grace Hopper today',
				mentions: [{ start: 4, length: 13, ...GRACE }],
			},
			{ id: 'c2', author: 'Grace Hopper', text: 'On it' },
		],
	},
];

function pane(setup: (el: OfficeUiCommentsPane) => void = () => {}): OfficeUiCommentsPane {
	const el = document.createElement('office-ui-comments-pane') as OfficeUiCommentsPane;
	el.threads = THREADS;
	setup(el);
	document.body.append(el);
	return el;
}
const root = (el: OfficeUiCommentsPane) => el.shadowRoot!;
const box = (el: OfficeUiCommentsPane, kind = 'new') =>
	root(el).querySelector<HTMLTextAreaElement>(`textarea.${kind}`)!;
const list = (el: OfficeUiCommentsPane) => root(el).querySelector<HTMLElement>('[role="listbox"]');
const options = (el: OfficeUiCommentsPane) => [
	...root(el).querySelectorAll<HTMLElement>('[role="option"]'),
];
const button = (el: OfficeUiCommentsPane, label: string) =>
	[...root(el).querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;
/** Type into a box: the new text, the caret at its end, and the input event the browser fires. */
function type(target: HTMLTextAreaElement, value: string) {
	target.value = value;
	target.setSelectionRange(value.length, value.length);
	target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}
function key(target: HTMLElement, name: string) {
	const event = new KeyboardEvent('keydown', {
		key: name,
		bubbles: true,
		composed: true,
		cancelable: true,
	});
	target.dispatchEvent(event);
	return event;
}
/** Put the caret at `at` with an arrow key, as a user moving through the text does. */
function caretTo(target: HTMLTextAreaElement, at: number) {
	target.setSelectionRange(at, at);
	target.dispatchEvent(
		new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true, composed: true }),
	);
}
function listen(el: HTMLElement, name: string) {
	const spy = vi.fn();
	el.addEventListener(name, (event) => spy((event as CustomEvent).detail));
	return spy;
}

describe('office-ui-comments-pane mentions', () => {
	it('draws mention spans in the text, keeping the text exact', () => {
		const el = pane((p) => (p.classNames = { mention: 'x-mention' }));
		const text = root(el).querySelector('.comment .text')!;
		expect(text.textContent).toBe('Ask @Grace Hopper today');
		const spans = [...text.querySelectorAll<HTMLElement>('.mention')];
		expect(spans.map((span) => span.textContent)).toEqual(['@Grace Hopper']);
		expect(spans[0]!.dataset.officeCommentMention).toBe('p2');
		expect(spans[0]!.title).toBe('Grace Hopper');
		expect(spans[0]!.classList.contains('x-mention')).toBe(true);
		expect(root(el).querySelectorAll('.mention')).toHaveLength(1);
	});

	it('offers no typeahead and adds no mentions to the events without candidates', () => {
		const el = pane((p) => (p.currentAuthor = 'Grace Hopper'));
		const add = listen(el, 'comment-add');
		const edit = listen(el, 'comment-edit');
		type(box(el), '@');
		expect(list(el)).toBeNull();
		expect(box(el).hasAttribute('aria-autocomplete')).toBe(false);
		type(box(el), '@Gr');
		button(el, 'Add comment').click();
		expect(add.mock.calls[0]![0]).toStrictEqual({ text: '@Gr' });
		button(el, 'Edit').click();
		type(box(el, 'edit-box'), 'On it now');
		button(el, 'Save').click();
		expect(edit.mock.calls[0]![0]).toStrictEqual({
			threadId: 't1',
			commentId: 'c2',
			text: 'On it now',
		});
	});

	it('opens on an @ at the start or after a space, best match first, not inside a word', () => {
		const el = pane((p) => (p.mentionCandidates = PEOPLE));
		const b = box(el);
		expect(b.getAttribute('aria-autocomplete')).toBe('list');
		type(b, 'mail@a');
		expect(list(el)).toBeNull();
		type(b, 'Hi @a');
		expect(list(el)!.getAttribute('aria-label')).toBe('People');
		expect(options(el).map((o) => o.textContent)).toEqual([
			'Ada Lovelace',
			'Alan Turing',
			'Grace Hopper',
		]);
		expect(options(el).map((o) => o.getAttribute('aria-selected'))).toEqual([
			'true',
			'false',
			'false',
		]);
		expect(b.getAttribute('aria-controls')).toBe(list(el)!.id);
		expect(b.getAttribute('aria-activedescendant')).toBe(options(el)[0]!.id);
		type(b, 'Hi @gh');
		expect(options(el).map((o) => o.textContent)).toEqual(['Grace Hopper']);
		type(b, 'Hi @zz');
		expect(list(el)).toBeNull();
		expect(b.hasAttribute('aria-activedescendant')).toBe(false);
		el.labels = { mentions: 'Personen' };
		type(b, '@');
		expect(list(el)!.getAttribute('aria-label')).toBe('Personen');
	});

	it('moves with the arrows, picks with Enter and posts the trimmed span', () => {
		const el = pane((p) => (p.mentionCandidates = PEOPLE));
		const add = listen(el, 'comment-add');
		const b = box(el);
		type(b, '  Hi @a');
		expect(key(b, 'ArrowDown').defaultPrevented).toBe(true);
		key(b, 'ArrowDown');
		key(b, 'ArrowDown');
		expect(b.getAttribute('aria-activedescendant')).toBe(options(el)[0]!.id);
		key(b, 'ArrowUp');
		expect(options(el)[2]!.getAttribute('aria-selected')).toBe('true');
		key(b, 'ArrowUp');
		expect(b.getAttribute('aria-activedescendant')).toBe(options(el)[1]!.id);
		expect(key(b, 'Enter').defaultPrevented).toBe(true);
		expect(b.value).toBe('  Hi @Alan Turing ');
		expect(b.selectionStart).toBe(18);
		expect(list(el)).toBeNull();
		expect(key(b, 'ArrowDown').defaultPrevented).toBe(false);
		type(b, `${b.value}thanks`);
		button(el, 'Add comment').click();
		expect(add.mock.calls).toEqual([
			[
				{
					text: 'Hi @Alan Turing thanks',
					mentions: [{ start: 3, length: 12, id: 'p3', name: 'Alan Turing' }],
				},
			],
		]);
		type(b, 'plain');
		button(el, 'Add comment').click();
		expect(add.mock.calls[1]![0]).toStrictEqual({ text: 'plain', mentions: [] });
	});

	it('picks with Tab or a click on an option, keeping the focus in the reply box', () => {
		const el = pane((p) => (p.mentionCandidates = PEOPLE));
		const reply = listen(el, 'comment-reply');
		const select = listen(el, 'thread-select');
		const r = box(el, 'reply-box');
		r.focus();
		type(r, '@');
		expect(key(r, 'Tab').defaultPrevented).toBe(true);
		expect(r.value).toBe('@Ada Lovelace ');
		type(r, `${r.value}and @gr`);
		const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
		options(el)[0]!.dispatchEvent(press);
		expect(press.defaultPrevented).toBe(true);
		options(el)[0]!.click();
		expect(r.value).toBe('@Ada Lovelace and @Grace Hopper ');
		expect(root(el).activeElement).toBe(r);
		expect(select).not.toHaveBeenCalled();
		button(el, 'Reply').click();
		expect(reply).toHaveBeenCalledWith({
			threadId: 't1',
			text: '@Ada Lovelace and @Grace Hopper',
			mentions: [
				{ start: 0, length: 13, id: 'p1', name: 'Ada Lovelace' },
				{ start: 18, length: 13, ...GRACE },
			],
		});
	});

	it('closes on Escape for that @ only, without leaving the edit or reaching the host', () => {
		const el = pane((p) => {
			p.mentionCandidates = PEOPLE;
			p.currentAuthor = 'Grace Hopper';
		});
		const outer = vi.fn();
		document.body.addEventListener('keydown', outer);
		button(el, 'Edit').click();
		const e = box(el, 'edit-box');
		type(e, 'On it @');
		expect(list(el)).not.toBeNull();
		expect(key(e, 'Escape').defaultPrevented).toBe(true);
		expect(list(el)).toBeNull();
		expect(box(el, 'edit-box')).toBe(e);
		type(e, 'On it @G');
		expect(list(el)).toBeNull();
		type(e, 'On it @G @');
		expect(list(el)).not.toBeNull();
		key(e, 'Escape');
		expect(box(el, 'edit-box')).toBe(e);
		key(e, 'Escape');
		expect(box(el, 'edit-box')).toBeNull();
		expect(outer).not.toHaveBeenCalled();
		document.body.removeEventListener('keydown', outer);
	});

	it('keeps an edited comment spans in line with the text, with or without candidates', () => {
		for (const candidates of [PEOPLE, []]) {
			const el = pane((p) => {
				p.mentionCandidates = candidates;
				p.currentAuthor = 'Ada Lovelace';
			});
			const edit = listen(el, 'comment-edit');
			button(el, 'Edit').click();
			expect(box(el, 'edit-box').value).toBe('Ask @Grace Hopper today');
			type(box(el, 'edit-box'), 'Please ask @Grace Hopper today');
			button(el, 'Save').click();
			button(el, 'Edit').click();
			type(box(el, 'edit-box'), 'Ask @Grace Hoper today');
			button(el, 'Save').click();
			expect(edit.mock.calls).toEqual([
				[
					{
						threadId: 't1',
						commentId: 'c1',
						text: 'Please ask @Grace Hopper today',
						mentions: [{ start: 11, length: 13, ...GRACE }],
					},
				],
				[{ threadId: 't1', commentId: 'c1', text: 'Ask @Grace Hoper today', mentions: [] }],
			]);
			el.remove();
		}
	});

	it('replaces a mention picked inside it instead of keeping both spans', () => {
		const el = pane((p) => {
			p.mentionCandidates = PEOPLE;
			p.currentAuthor = 'Ada Lovelace';
		});
		const edit = listen(el, 'comment-edit');
		button(el, 'Edit').click();
		const e = box(el, 'edit-box');
		caretTo(e, 6);
		expect(options(el).map((o) => o.textContent)).toEqual(['Grace Hopper', 'Alan Turing']);
		key(e, 'ArrowDown');
		key(e, 'Enter');
		expect(e.value).toBe('Ask @Alan Turing race Hopper today');
		button(el, 'Save').click();
		expect(edit.mock.calls[0]![0].mentions).toStrictEqual([
			{ start: 4, length: 12, id: 'p3', name: 'Alan Turing' },
		]);
	});

	it('saves an edit that only changes the mentions, and nothing for no change', () => {
		const el = pane((p) => {
			p.mentionCandidates = PEOPLE;
			p.currentAuthor = 'Ada Lovelace';
			p.threads = [
				...THREADS,
				{
					id: 't2',
					resolved: false,
					comments: [{ id: 'c3', author: 'Ada Lovelace', text: '@Grace Hopper' }],
				},
			];
		});
		const edit = listen(el, 'comment-edit');
		const [first, second] = [
			...root(el).querySelectorAll<HTMLButtonElement>('[data-action="edit"]'),
		];
		first!.click();
		button(el, 'Save').click();
		expect(edit).not.toHaveBeenCalled();
		first!.click();
		type(box(el, 'edit-box'), 'Ask @Grace Hoppe today');
		type(box(el, 'edit-box'), 'Ask @Grace Hopper today');
		button(el, 'Save').click();
		second!.click();
		type(box(el, 'edit-box'), '@Gr');
		key(box(el, 'edit-box'), 'Enter');
		button(el, 'Save').click();
		expect(edit.mock.calls).toEqual([
			[{ threadId: 't1', commentId: 'c1', text: 'Ask @Grace Hopper today', mentions: [] }],
			[
				{
					threadId: 't2',
					commentId: 'c3',
					text: '@Grace Hopper',
					mentions: [{ start: 0, length: 13, ...GRACE }],
				},
			],
		]);
	});

	it('keeps the spans of a comment with CRLF line breaks, and an unchanged save sends nothing', () => {
		const el = pane((p) => {
			p.mentionCandidates = PEOPLE;
			p.currentAuthor = 'Ada Lovelace';
			p.threads = [
				{
					id: 't3',
					resolved: false,
					comments: [
						{
							id: 'c5',
							author: 'Ada Lovelace',
							text: 'A\r\n@Grace Hopper\r\nZ',
							mentions: [{ start: 3, length: 13, ...GRACE }],
						},
					],
				},
			];
		});
		const edit = listen(el, 'comment-edit');
		button(el, 'Edit').click();
		button(el, 'Save').click();
		expect(edit).not.toHaveBeenCalled();
		button(el, 'Edit').click();
		type(box(el, 'edit-box'), `${box(el, 'edit-box').value}!`);
		button(el, 'Save').click();
		expect(edit).toHaveBeenCalledWith({
			threadId: 't3',
			commentId: 'c5',
			text: 'A\n@Grace Hopper\nZ!',
			mentions: [{ start: 2, length: 13, ...GRACE }],
		});
	});

	it('keeps the list open when the focus moves onto one of its options', () => {
		const el = pane((p) => (p.mentionCandidates = PEOPLE));
		const b = box(el);
		type(b, '@');
		const option = options(el)[0]!;
		b.dispatchEvent(
			new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: option }),
		);
		expect(list(el)).not.toBeNull();
		option.click();
		expect(b.value).toBe('@Ada Lovelace ');
		type(b, '@');
		b.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
		expect(list(el)).toBeNull();
	});

	it('keeps a mention when another is typed right before it', () => {
		const el = pane((p) => {
			p.mentionCandidates = PEOPLE;
			p.currentAuthor = 'Ada Lovelace';
		});
		const edit = listen(el, 'comment-edit');
		button(el, 'Edit').click();
		const e = box(el, 'edit-box');
		e.value = 'Ask @@Grace Hopper today';
		e.setSelectionRange(5, 5);
		e.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
		expect(options(el)[0]!.textContent).toBe('Ada Lovelace');
		key(e, 'Enter');
		expect(e.value).toBe('Ask @Ada Lovelace @Grace Hopper today');
		button(el, 'Save').click();
		expect(edit.mock.calls[0]![0].mentions).toStrictEqual([
			{ start: 4, length: 13, id: 'p1', name: 'Ada Lovelace' },
			{ start: 18, length: 13, ...GRACE },
		]);
	});

	it('follows a change of candidates while the list is open', () => {
		const el = pane((p) => (p.mentionCandidates = PEOPLE));
		const b = box(el);
		type(b, '@a');
		key(b, 'ArrowDown');
		key(b, 'ArrowDown');
		el.mentionCandidates = [PEOPLE[0]!];
		expect(options(el).map((o) => o.textContent)).toEqual(['Ada Lovelace']);
		expect(b.getAttribute('aria-activedescendant')).toBe(options(el)[0]!.id);
		caretTo(b, 2);
		key(b, 'Enter');
		expect(b.value).toBe('@Ada Lovelace ');
		type(b, '@');
		el.mentionCandidates = [];
		expect(list(el)).toBeNull();
	});

	it('offers nothing in read-only boxes', () => {
		const el = pane((p) => {
			p.mentionCandidates = PEOPLE;
			p.readOnly = true;
		});
		expect(box(el).hasAttribute('aria-autocomplete')).toBe(false);
		type(box(el), '@');
		expect(list(el)).toBeNull();
	});
});
