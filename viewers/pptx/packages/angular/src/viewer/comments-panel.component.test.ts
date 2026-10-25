/**
 * CommentsPanelComponent: the shared comments pane (`pptx-ui-comments-pane`) in Angular. The pane
 * is driven through its own boxes and buttons, inside its shadow root; the tests read what the
 * outputs carry: the whole new list for the viewer, and each change for a host that handles them.
 */
import { signal } from '@angular/core';
import type { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { createPptxCommentDrafts } from 'ooxml-ui/pptx';
import type { PptxComment, PptxElement } from 'pptx-viewer-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { translationsEn } from '../../../../../../src/ui/src/pptx/i18n';
import { registerPptxWebControls } from '../../../../../../src/ui/src/pptx/web-components';
import { CommentsPanelComponent, commentsPanelIntent } from './comments-panel.component';
import type { CommentSubmission } from './comments-panel.component';

beforeAll(() => {
	TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
	registerPptxWebControls();
});
afterEach(() => {
	TestBed.resetTestingModule();
	document.body.replaceChildren();
});

const SHAPE = { id: 'shape-1', type: 'shape', name: 'Title' } as unknown as PptxElement;
const ALICE = { id: 'a1', name: 'Alice', userId: '', providerId: '' };

function open(values: Record<string, unknown>) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [CommentsPanelComponent],
		providers: [provideTranslateService({ fallbackLang: 'en' })],
	});
	// The Vitest JIT build does not wire signal inputs: declare them and hand each a plain signal.
	TestBed.overrideComponent(CommentsPanelComponent, { add: { inputs: Object.keys(values) } });
	const fixture = TestBed.createComponent(CommentsPanelComponent);
	const inputs: Record<string, WritableSignal<unknown>> = {};
	for (const [name, value] of Object.entries(values)) {
		inputs[name] = signal(value);
		fixture.componentRef.setInput(name, inputs[name]);
	}
	const translate = TestBed.inject(TranslateService);
	translate.setTranslation('en', translationsEn);
	translate.use('en');
	fixture.detectChanges();
	const panel = fixture.componentInstance;
	const out = {
		lists: [] as PptxComment[][],
		added: [] as CommentSubmission[],
		selected: [] as unknown[],
	};
	panel.commentsChange.subscribe((next) => out.lists.push(next));
	panel.add.subscribe((value) => out.added.push(value));
	panel.threadSelect.subscribe((value) => out.selected.push(value));
	const root = () =>
		(fixture.nativeElement as HTMLElement).querySelector('pptx-ui-comments-pane')!.shadowRoot!;
	const button = (label: string) =>
		[...root().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;
	return { fixture, inputs, out, root, button };
}

/** Type into a box with the caret at the end, as the browser reports it. */
function type(box: HTMLTextAreaElement, value: string): void {
	box.value = value;
	box.setSelectionRange(value.length, value.length);
	box.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

describe('comments panel on the shared pane', () => {
	it('writes a new comment on the selected element, its mention on the trimmed text', () => {
		const { out, root, button } = open({
			comments: [],
			authorName: 'Ada',
			modernCommentAuthors: [ALICE],
			elements: [SHAPE],
			selectedElementId: 'shape-1',
		});
		type(root().querySelector<HTMLTextAreaElement>('textarea.new')!, '  hey @al');
		root().querySelector<HTMLElement>('[role="option"]')!.click();
		button('Add Comment').click();

		const added = out.lists[0]!.at(-1)!;
		expect(added).toMatchObject({ text: 'hey @Alice', author: 'Ada', elementId: 'shape-1' });
		const [mention] = added.mentions!;
		expect(added.text.slice(mention!.startIndex, mention!.startIndex + mention!.length)).toBe(
			'@Alice',
		);
		// The per-change output carries the same text and span.
		expect(out.added[0]!.text).toBe('hey @Alice');
		expect(out.added[0]!.mentions[0]).toMatchObject({ personId: 'a1', startIndex: 4, length: 6 });
	});

	it('follows its inputs, writes a reply and a resolve, and reports a picked thread', () => {
		const comments: PptxComment[] = [
			{ id: 'c1', text: 'On the title', author: 'Grace', elementId: 'shape-1' },
		];
		const { fixture, inputs, out, root, button } = open({
			comments,
			authorName: 'Ada',
			elements: [SHAPE],
		});
		expect(root().querySelectorAll('[data-thread-id]')).toHaveLength(1);

		type(root().querySelector<HTMLTextAreaElement>('textarea.reply-box')!, 'Answer');
		button('Reply').click();
		expect(out.lists[0]![0]!.replies!.map((reply) => reply.text)).toStrictEqual(['Answer']);

		button('Resolve').click();
		expect(out.lists[1]![0]!.resolved).toBeTruthy();

		root().querySelector<HTMLElement>('.thread .text')!.click();
		expect(out.selected).toStrictEqual([{ commentId: 'c1', elementId: 'shape-1' }]);

		inputs['comments']!.set([...comments, { id: 'c2', text: 'Another', author: 'Ada' }]);
		fixture.detectChanges();
		expect(root().querySelectorAll('[data-thread-id]')).toHaveLength(2);
	});

	it('keeps an unposted comment across a destroy, per slide', () => {
		const drafts = createPptxCommentDrafts();
		const first = open({ comments: [], authorName: 'Ada', drafts, draftKey: 'slide-1' });
		type(first.root().querySelector<HTMLTextAreaElement>('textarea.new')!, 'Half a thought');
		first.fixture.destroy();

		const back = open({ comments: [], authorName: 'Ada', drafts, draftKey: 'slide-1' });
		const box = () => back.root().querySelector<HTMLTextAreaElement>('textarea.new')!;
		expect(box().value).toBe('Half a thought');
		back.inputs.draftKey!.set('slide-2');
		back.fixture.detectChanges();
		expect(box().value).toBe('');
		back.inputs.draftKey!.set('slide-1');
		back.fixture.detectChanges();
		expect(box().value).toBe('Half a thought');
	});

	it('writes nothing while not editable', () => {
		const { fixture, out, root } = open({
			comments: [{ id: 'c1', text: 'Here', author: 'Ada' }],
			authorName: 'Ada',
			editable: false,
		});
		expect(root().querySelector<HTMLTextAreaElement>('textarea.new')!.disabled).toBeTruthy();
		(fixture.nativeElement as HTMLElement)
			.querySelector('pptx-ui-comments-pane')!
			.dispatchEvent(new CustomEvent('comment-add', { detail: { text: 'x' } }));
		expect(out.lists).toStrictEqual([]);
		expect(out.added).toStrictEqual([]);
	});
});

describe('commentsPanelIntent', () => {
	const comments: PptxComment[] = [
		{
			id: 'c1',
			text: 'Ask @Alice',
			mentions: [{ id: '{M}', personId: 'a1', authorName: 'Alice', startIndex: 4, length: 6 }],
		},
	];

	it('keeps an edited comment its mention records, moved with the text', () => {
		const intent = commentsPanelIntent(
			{
				type: 'comment-edit',
				detail: {
					threadId: 'c1',
					commentId: 'c1',
					text: 'Please ask @Alice',
					mentions: [{ start: 11, length: 6, id: 'a1', key: '{M}' }],
				},
			},
			comments,
		);
		expect(intent).toStrictEqual({
			output: 'edit',
			value: {
				id: 'c1',
				text: 'Please ask @Alice',
				mentions: [{ id: '{M}', personId: 'a1', authorName: 'Alice', startIndex: 11, length: 6 }],
			},
		});
	});

	it('maps a delete, a resolve and a reopen onto remove and the resolve toggle', () => {
		expect(
			commentsPanelIntent(
				{ type: 'comment-delete', detail: { threadId: 'c1', commentId: 'r1' } },
				comments,
			),
		).toStrictEqual({ output: 'remove', value: 'r1' });
		for (const kind of ['thread-resolve', 'thread-reopen'] as const) {
			expect(
				commentsPanelIntent({ type: kind, detail: { threadId: 'c1' } }, comments),
			).toStrictEqual({
				output: 'resolve',
				value: 'c1',
			});
		}
	});
});
