import { describe, expect, it } from 'vitest';
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import * as Y from 'yjs';
import { notebookSchema } from './editor/schema';
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
