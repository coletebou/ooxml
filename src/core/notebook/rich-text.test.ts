import { describe, expect, it } from 'vitest';
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import * as Y from 'yjs';
import { notebookSchema } from './editor/schema';
import { MAX_LIST_LEVELS, MAX_TEXT_LENGTH } from './model';
import {
	type RichNode,
	plainText,
	readRichText,
	richTextFromPlain,
	textBlocks,
	writeRichText,
} from './rich-text';

const fragment = (): Y.XmlFragment => new Y.Doc().getXmlFragment('t');

const sample: RichNode[] = [
	{ type: 'heading', attrs: { level: 2, todo: null }, content: [{ type: 'text', text: 'Plan' }] },
	{
		type: 'paragraph',
		attrs: { todo: 'open' },
		content: [
			{ type: 'text', text: 'Buy ' },
			{
				type: 'text',
				text: 'milk',
				marks: [{ type: 'bold' }, { type: 'highlight', attrs: { color: 'green' } }],
			},
			{ type: 'hard_break' },
			{
				type: 'text',
				text: 'site',
				marks: [
					{ type: 'link', attrs: { href: 'https://example.com', anchor: null, tooltip: null } },
				],
			},
		],
	},
	{
		type: 'bullet_list',
		content: [
			{
				type: 'list_item',
				content: [
					{ type: 'paragraph', attrs: { todo: 'done' }, content: [{ type: 'text', text: 'one' }] },
					{
						type: 'ordered_list',
						attrs: { order: 3 },
						content: [
							{
								type: 'list_item',
								content: [
									{
										type: 'paragraph',
										attrs: { todo: null },
										content: [{ type: 'text', text: 'deep', marks: [{ type: 'italic' }] }],
									},
								],
							},
						],
					},
				],
			},
		],
	},
];

describe('rich text in the y-prosemirror encoding', () => {
	it('round-trips through a fragment', () => {
		const f = fragment();
		writeRichText(f, sample);
		expect(readRichText(f)).toEqual(sample);
	});

	it('reads what y-prosemirror writes and writes what it reads', () => {
		const pmDoc = notebookSchema.nodeFromJSON({ type: 'doc', content: sample });
		const written = prosemirrorToYXmlFragment(pmDoc, fragment());
		expect(readRichText(written)).toEqual(sample);

		const ours = fragment();
		writeRichText(ours, sample);
		const back = yXmlFragmentToProseMirrorRootNode(ours, notebookSchema);
		expect(back.toJSON().content).toEqual(sample);
	});

	it('drops what the schema does not allow and keeps the text', () => {
		const f = fragment();
		const strange = new Y.XmlElement('blockquote');
		const text = new Y.XmlText();
		text.applyDelta([
			{ insert: 'quoted ', attributes: { comment: { id: 1 } } },
			{ insert: 'link', attributes: { link: { href: 'javascript:alert(1)' }, 'bold--abc': {} } },
		]);
		strange.insert(0, [text]);
		const heading = new Y.XmlElement('heading');
		heading.setAttribute('level', '9' as never);
		heading.setAttribute('todo', 'maybe');
		heading.insert(0, [new Y.XmlText('Title')]);
		f.insert(0, [strange, heading]);
		expect(readRichText(f)).toEqual([
			{
				type: 'paragraph',
				attrs: { todo: null },
				content: [
					{ type: 'text', text: 'quoted ' },
					{ type: 'text', text: 'link', marks: [{ type: 'bold' }] },
				],
			},
			{
				type: 'heading',
				attrs: { level: 1, todo: null },
				content: [{ type: 'text', text: 'Title' }],
			},
		]);
	});

	it('lists blocks with their to-do tags and list context', () => {
		expect(textBlocks(sample).map((b) => [b.text, b.todo, b.listDepth, b.list])).toEqual([
			['Plan', null, 0, null],
			['Buy milk\nsite', 'open', 0, null],
			['one', 'done', 1, 'bullet'],
			['deep', null, 2, 'ordered'],
		]);
		expect(plainText(sample)).toBe('Plan\nBuy milk\nsite\none\ndeep');
	});

	it('writes any shape an archive holds without throwing, keeping only the valid parts', () => {
		let deep: unknown = { type: 'paragraph', content: [{ type: 'text', text: 'too deep' }] };
		for (let i = 0; i < 5000; i++)
			deep = { type: 'bullet_list', content: [{ type: 'list_item', content: [deep] }] };
		const hostile = [
			{ type: 'paragraph', content: 'not a list' },
			{ type: 'heading', content: { type: 'text', text: 'an object' } },
			{
				type: 'bullet_list',
				content: [
					null,
					7,
					'item',
					{
						type: 'list_item',
						content: [{ type: 'paragraph', content: [null, { type: 'text', text: 'kept' }] }],
					},
				],
			},
			{
				type: 'paragraph',
				content: [
					{ type: 'text', text: 5 },
					{ type: 'text', text: 'marks as text, ', marks: 'bold' },
					{ type: 'text', text: 'bold', marks: [null, 3, { type: 'bold' }] },
					{ type: 'hard_break', content: 'x' },
				],
			},
			deep,
		] as unknown as RichNode[];
		const f = fragment();
		expect(() => writeRichText(f, hostile)).not.toThrow();
		const read = readRichText(f);
		// Two emptied blocks, the list item, the paragraph (its break ends a line), and the deepest
		// list item the depth limit keeps, emptied.
		expect(plainText(read)).toBe('\n\nkept\nmarks as text, bold\n\n');
		expect(JSON.stringify(read)).not.toContain('too deep');
		const runs = read.flatMap((b) => b.content ?? []);
		expect(runs.find((r) => r.text === 'bold')?.marks).toEqual([{ type: 'bold' }]);
	});

	it('keeps the text of a list nested as deep as the editor allows', () => {
		let deep: RichNode = {
			type: 'paragraph',
			attrs: { todo: null },
			content: [{ type: 'text', text: 'deepest' }],
		};
		for (let i = 0; i < MAX_LIST_LEVELS; i++)
			deep = { type: 'bullet_list', content: [{ type: 'list_item', content: [deep] }] };
		const f = fragment();
		writeRichText(f, [deep]);
		const blocks = textBlocks(readRichText(f));
		expect(blocks.map((b) => [b.text, b.listDepth])).toEqual([['deepest', MAX_LIST_LEVELS]]);
	});

	it('keeps at most the text a container holds, on write as on read', () => {
		const f = fragment();
		const long = 'a'.repeat(MAX_TEXT_LENGTH - 5);
		writeRichText(f, [
			{ type: 'paragraph', attrs: { todo: null }, content: [{ type: 'text', text: long }] },
			{ type: 'paragraph', attrs: { todo: null }, content: [{ type: 'text', text: '0123456789' }] },
		]);
		const text = plainText(readRichText(f));
		expect(text).toBe(`${long}\n01234`);
		// What was written is read back whole, so an archive or export keeps all of it.
		expect(
			f
				.toArray()
				.map((p) => (p as Y.XmlElement).toArray().map(String).join(''))
				.join('\n'),
		).toBe(text);
	});

	it('turns pasted plain text into paragraphs', () => {
		const blocks = richTextFromPlain('a\r\n\r\nb');
		expect(blocks).toHaveLength(3);
		const f = fragment();
		writeRichText(f, blocks);
		expect(plainText(readRichText(f))).toBe('a\n\nb');
		writeRichText(f, []);
		expect(readRichText(f)).toEqual([{ type: 'paragraph', attrs: { todo: null } }]);
	});
});
