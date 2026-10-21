import type { Node } from 'prosemirror-model';
import { type Command, EditorState, TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import {
	activeFormats,
	enter,
	indentListItem,
	linkRangeAt,
	outdentListItem,
	setBlockStyle,
	setLink,
	setTodoAt,
	toggleFormat,
	toggleHighlight,
	toggleList,
	toggleTodo,
} from './commands';
import { notebookInputRules } from './input-rules';
import { notebookSchema as schema } from './schema';

const p = (text: string, todo: string | null = null) => ({
	type: 'paragraph',
	attrs: { todo },
	content: text ? [{ type: 'text', text }] : [],
});

function state(content: object[], from = 1, to = from): EditorState {
	const doc = schema.nodeFromJSON({ type: 'doc', content });
	return EditorState.create({ schema, doc, selection: TextSelection.create(doc, from, to) });
}
function run(s: EditorState, command: Command): EditorState {
	let next = s;
	command(s, (tr) => (next = s.apply(tr)));
	return next;
}
const json = (s: EditorState) => (s.doc.toJSON() as { content: object[] }).content;
const types = (doc: Node): string[] => {
	const out: string[] = [];
	doc.descendants((n) => void out.push(n.type.name));
	return out;
};

/** Type `text` at the cursor, letting input rules run as a view would. */
function type(s: EditorState, text: string): EditorState {
	let current = s;
	for (const char of text) {
		const { from, to } = current.selection;
		const before = current.doc.textBetween(Math.max(0, from - 50), from, undefined, '￼') + char;
		let handled = false;
		for (const rule of notebookInputRules) {
			const match = (rule as unknown as { match: RegExp }).match.exec(before);
			if (!match) continue;
			const handler = (
				rule as unknown as {
					handler: (s: EditorState, m: RegExpExecArray, a: number, b: number) => unknown;
				}
			).handler;
			const tr = handler(current, match, from - (match[0].length - char.length), to);
			if (tr) {
				current = current.apply(tr as never);
				handled = true;
				break;
			}
		}
		if (!handled) current = current.apply(current.tr.insertText(char));
	}
	return current;
}

describe('notebook editor commands', () => {
	it('toggles inline formats and highlight, and reports them as active', () => {
		let s = state([p('hello world')], 1, 6);
		s = run(s, toggleFormat('bold'));
		s = run(s, toggleFormat('strike'));
		s = run(s, toggleHighlight('green'));
		const formats = activeFormats(s);
		expect(formats).toMatchObject({
			bold: true,
			strike: true,
			highlight: true,
			italic: false,
			block: 'paragraph',
			list: null,
			todo: false,
		});
		const marks = (json(s)[0] as { content: { marks?: { type: string; attrs?: object }[] }[] })
			.content[0]!.marks!;
		expect(marks.map((m) => m.type)).toEqual(['bold', 'strike', 'highlight']);
		s = run(s, toggleHighlight());
		expect(activeFormats(s).highlight).toBe(false);
		// With an empty selection the mark applies to what is typed next.
		let empty = state([p('')], 1);
		empty = run(empty, toggleHighlight());
		empty = empty.apply(empty.tr.insertText('x'));
		expect(activeFormats(state([p('')]))).toMatchObject({ highlight: false });
		expect(JSON.stringify(json(empty))).toContain('highlight');
	});

	it('switches block styles and keeps a to-do tag', () => {
		let s = state([p('Title', 'open')], 2);
		s = run(s, setBlockStyle('heading2'));
		expect(json(s)[0]).toMatchObject({ type: 'heading', attrs: { level: 2, todo: 'open' } });
		expect(activeFormats(s).block).toBe('heading2');
		s = run(s, setBlockStyle('paragraph'));
		expect(json(s)[0]).toMatchObject({ type: 'paragraph', attrs: { todo: 'open' } });
	});

	it('turns lists on, switches their kind, indents and turns them off', () => {
		let s = state([p('a'), p('b')], 1, 5);
		s = run(s, toggleList('bullet'));
		expect(types(s.doc)).toEqual([
			'bullet_list',
			'list_item',
			'paragraph',
			'text',
			'list_item',
			'paragraph',
			'text',
		]);
		s = run(s, toggleList('ordered'));
		expect(activeFormats(s).list).toBe('ordered');
		// Put the cursor in "b" and indent it under "a".
		s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 8)));
		s = run(s, indentListItem);
		expect(types(s.doc).filter((t) => t.endsWith('_list'))).toEqual([
			'ordered_list',
			'ordered_list',
		]);
		s = run(s, outdentListItem);
		s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1, s.doc.content.size - 1)));
		s = run(s, toggleList('ordered'));
		expect(types(s.doc).filter((t) => t.endsWith('_list'))).toEqual([]);
	});

	it('tags to-dos, ticks them, continues them on Enter and ends them on an empty line', () => {
		let s = state([p('milk'), p('eggs')], 1, 9);
		s = run(s, toggleTodo);
		expect(json(s).map((b) => (b as { attrs: { todo: string } }).attrs.todo)).toEqual([
			'open',
			'open',
		]);
		s = run(s, setTodoAt(0, 'done'));
		expect((json(s)[0] as { attrs: { todo: string } }).attrs.todo).toBe('done');
		s = run(s, toggleTodo);
		expect(json(s).map((b) => (b as { attrs: { todo: string } }).attrs.todo)).toEqual([null, null]);
		s = run(state([p('milk', 'done')], 5), enter);
		expect(json(s)).toEqual([p('milk', 'done'), { type: 'paragraph', attrs: { todo: 'open' } }]);
		s = run(s, enter);
		expect(json(s)).toEqual([p('milk', 'done'), { type: 'paragraph', attrs: { todo: null } }]);
		expect(run(state([p('x')]), setTodoAt(0, 'done')).doc.eq(state([p('x')]).doc)).toBe(true);
	});

	it('only links to http, https and mailto, and inserts the address when nothing is selected', () => {
		let s = state([p('docs here')], 1, 5);
		expect(setLink('javascript:alert(1)')(s)).toBe(false);
		s = run(s, setLink(' https://example.com '));
		expect(activeFormats(state(json(s), 2)).link).toBe('https://example.com');
		s = run(s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1, 5))), setLink(null));
		expect(JSON.stringify(json(s))).not.toContain('link');
		const inserted = run(state([p('')], 1), setLink('mailto:a@example.com', 'Mail'));
		expect(inserted.doc.textContent).toBe('Mail');
	});

	it('autoformats lists, headings and to-dos as you type', () => {
		expect(types(type(state([p('')]), '* x').doc)).toEqual([
			'bullet_list',
			'list_item',
			'paragraph',
			'text',
		]);
		const numbered = type(state([p('')]), '3. x');
		expect(json(numbered)[0]).toMatchObject({ type: 'ordered_list', attrs: { order: 3 } });
		expect(json(type(state([p('')]), '## x'))[0]).toMatchObject({
			type: 'heading',
			attrs: { level: 2 },
		});
		expect(json(type(state([p('')]), '[x] done'))[0]).toEqual(p('done', 'done'));
		expect(json(type(state([p('')]), '[] open'))[0]).toEqual(p('open', 'open'));
	});

	it('parses pasted web links and drops unsafe ones', () => {
		const rules = schema.marks.link!.spec.parseDOM!;
		const plain = rules.find((r) => 'tag' in r && r.tag === 'a[href]')!;
		const attrs = (href: string) =>
			(plain as { getAttrs: (el: unknown) => unknown }).getAttrs({ getAttribute: () => href });
		expect(attrs('https://example.com')).toEqual({
			href: 'https://example.com',
			anchor: null,
			tooltip: null,
		});
		expect(attrs('javascript:alert(1)')).toBe(false);
	});

	it('changes the style of each selected block and keeps each one its own to-do tag', () => {
		let s = state([p('plain'), p('done', 'done')], 1, 12);
		s = run(s, setBlockStyle('heading1'));
		expect(json(s)).toMatchObject([
			{ type: 'heading', attrs: { level: 1, todo: null } },
			{ type: 'heading', attrs: { level: 1, todo: 'done' } },
		]);
		s = run(s, setBlockStyle('paragraph'));
		expect(json(s).map((b) => (b as { attrs: { todo: string | null } }).attrs.todo)).toEqual([
			null,
			'done',
		]);
	});

	it('edits and removes the whole link around a collapsed cursor', () => {
		const linked = {
			type: 'link',
			attrs: { href: 'https://a.example', anchor: null, tooltip: null },
		};
		const doc = [
			{
				type: 'paragraph',
				attrs: { todo: null },
				content: [
					{ type: 'text', text: 'see ' },
					{ type: 'text', text: 'docs', marks: [linked] },
				],
			},
		];
		let s = state(doc, 7);
		expect(linkRangeAt(s, 7)).toEqual({ from: 5, to: 9, href: 'https://a.example' });
		s = run(s, setLink('https://b.example'));
		expect(s.doc.textContent).toBe('see docs');
		expect(activeFormats(state(json(s), 7)).link).toBe('https://b.example');
		s = run(state(json(s), 7), setLink(null));
		expect(JSON.stringify(json(s))).not.toContain('link');
		expect(linkRangeAt(s, 2)).toBeNull();
	});
});
