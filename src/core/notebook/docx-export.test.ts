import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { loadDocx } from '../docx/parse';
import type { Paragraph } from '../docx/model-paragraph';
import { type PageExportItem, exportPageToDocx } from './docx-export';
import type { RichNode } from './rich-text';

const png = (n: number): Uint8Array =>
	new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n, n, n]);
const text = (t: string, marks?: RichNode['marks']): RichNode =>
	marks ? { type: 'text', text: t, marks } : { type: 'text', text: t };

const blocks: RichNode[] = [
	{ type: 'heading', attrs: { level: 2, todo: null }, content: [text('Agenda')] },
	{
		type: 'paragraph',
		attrs: { todo: 'done' },
		content: [
			text('Bold', [{ type: 'bold' }]),
			text(' and '),
			text('marked', [
				{ type: 'italic' },
				{ type: 'underline' },
				{ type: 'strike' },
				{ type: 'highlight', attrs: { color: 'green' } },
			]),
			{ type: 'hard_break' },
			text('link', [{ type: 'link', attrs: { href: 'https://example.com/a' } }]),
		],
	},
	{
		type: 'ordered_list',
		attrs: { order: 1 },
		content: [
			{
				type: 'list_item',
				content: [{ type: 'paragraph', attrs: { todo: null }, content: [text('first')] }],
			},
			{
				type: 'list_item',
				content: [
					{ type: 'paragraph', attrs: { todo: 'open' }, content: [text('second')] },
					{
						type: 'ordered_list',
						content: [
							{
								type: 'list_item',
								content: [{ type: 'paragraph', attrs: { todo: null }, content: [text('nested')] }],
							},
						],
					},
					{
						type: 'bullet_list',
						content: [
							{
								type: 'list_item',
								content: [{ type: 'paragraph', attrs: { todo: null }, content: [text('bullet')] }],
							},
						],
					},
				],
			},
		],
	},
];

const paragraphs = (model: { blocks: unknown[] }): Paragraph[] =>
	model.blocks.filter((b): b is Paragraph => (b as Paragraph).type === 'paragraph');
const textOf = (p: Paragraph): string => p.runs.map((r) => r.text).join('');

describe('page export to .docx', () => {
	it('writes containers in reading order with styles, lists, to-dos, marks and pictures', async () => {
		const items: PageExportItem[] = [
			{
				kind: 'image',
				x: 0,
				y: 400,
				width: 1248,
				height: 100,
				name: 'wide.png',
				mime: 'image/png',
				alt: 'Wide',
				bytes: png(1),
			},
			{
				kind: 'text',
				x: 400,
				y: 10,
				blocks: [{ type: 'paragraph', attrs: { todo: null }, content: [text('Right column')] }],
			},
			{ kind: 'text', x: 0, y: 0, blocks },
			{ kind: 'file', x: 0, y: 900, name: 'Budget.xlsx', size: 10 },
			{ kind: 'ink', x: 0, y: 600, strokes: [], bounds: { x: 0, y: 600, width: 30, height: 20 } },
		];
		const requests: string[] = [];
		const { bytes, report } = await exportPageToDocx(
			{ title: 'Meeting', subtitle: 'Tuesday', items },
			{
				rasterize: async (request) => {
					requests.push(request.kind);
					return { bytes: png(2), width: 30, height: 20 };
				},
				fileLabel: (file) => `File: ${file.name}`,
			},
		);
		expect(report).toEqual({ pictures: 1, ink: 1, files: 1, skipped: [] });
		expect(requests).toEqual(['ink']);
		const loaded = await loadDocx(bytes);
		const ps = paragraphs(loaded.model);
		expect(ps.map(textOf)).toEqual([
			'Meeting',
			'Tuesday',
			'Agenda',
			'☒ Bold and marked\nlink',
			'first',
			'☐ second',
			'nested',
			'bullet',
			'Right column',
			'',
			'',
			'File: Budget.xlsx',
		]);
		expect(ps[0]?.style).toBe('Title');
		expect(ps[2]?.style).toBe('Heading2');
		const marked = ps[3]!.runs.find((r) => r.text === 'marked')!;
		expect(marked).toMatchObject({
			italic: true,
			underline: true,
			strike: true,
			highlight: 'green',
		});
		expect(ps[3]!.runs.find((r) => r.text === 'Bold')?.bold).toBe(true);
		expect(ps[3]!.runs.find((r) => r.text === 'link')?.link?.href).toBe('https://example.com/a');
		const box = ps[3]!.runs[0]!.contentControl!;
		expect(box).toMatchObject({ kind: 'checkbox', checked: true });
		expect(ps[5]!.runs[0]!.contentControl).toMatchObject({ kind: 'checkbox', checked: false });
		// The ordered list continues one level deeper; the nested bullets are a list of their own.
		const [first, second, nested, bullet] = [ps[4]!, ps[5]!, ps[6]!, ps[7]!].map(
			(p) => p.numbering,
		);
		expect(first).toEqual(second);
		expect(nested).toEqual({ numId: first!.numId, level: 1 });
		expect(bullet?.level).toBe(1);
		expect(bullet?.numId).not.toBe(first!.numId);
		// Pictures: the wide one is scaled to the text width; ink is the rasterised PNG.
		const wide = ps[9]!.runs[0]!.image!;
		expect([wide.widthPx, wide.heightPx, wide.altText]).toEqual([624, 50, 'Wide']);
		const ink = ps[10]!.runs[0]!.image!;
		expect([ink.widthPx, ink.heightPx]).toEqual([30, 20]);
		expect(loaded.media?.get(wide.partName)).toEqual(png(1));
		expect(loaded.media?.get(ink.partName)).toEqual(png(2));
		const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
		expect(xml).toContain('w14:checkbox');
	});

	it('reports what it could not write instead of dropping it silently', async () => {
		const { bytes, report } = await exportPageToDocx({
			title: 'Untitled page',
			items: [
				{
					kind: 'image',
					x: 0,
					y: 0,
					width: 10,
					height: 10,
					name: 'a.webp',
					mime: 'image/webp',
					alt: '',
					bytes: png(3),
				},
				{
					kind: 'image',
					x: 0,
					y: 20,
					width: 10,
					height: 10,
					name: 'gone.png',
					mime: 'image/png',
					alt: '',
					bytes: null,
				},
				{ kind: 'ink', x: 0, y: 40, strokes: [], bounds: { x: 0, y: 40, width: 1, height: 1 } },
				{ kind: 'text', x: 0, y: 60, blocks: [{ type: 'paragraph', attrs: { todo: null } }] },
			],
		});
		expect(report.skipped).toEqual([
			{ kind: 'image', name: 'a.webp', reason: 'no-rasterizer' },
			{ kind: 'image', name: 'gone.png', reason: 'no-bytes' },
			{ kind: 'ink', reason: 'no-rasterizer' },
		]);
		const ps = paragraphs((await loadDocx(bytes)).model);
		// Only the title: the empty text container adds nothing.
		expect(ps.map(textOf)).toEqual(['Untitled page']);
	});

	it('keeps the start number of a numbered list', async () => {
		const { bytes } = await exportPageToDocx({
			title: 'Steps',
			items: [
				{
					kind: 'text',
					x: 0,
					y: 0,
					blocks: [
						{
							type: 'ordered_list',
							attrs: { order: 3 },
							content: [
								{
									type: 'list_item',
									content: [{ type: 'paragraph', attrs: { todo: null }, content: [text('third')] }],
								},
							],
						},
					],
				},
			],
		});
		const loaded = await loadDocx(bytes);
		const item = paragraphs(loaded.model).find((p) => textOf(p) === 'third')!;
		const instance = loaded.model.numberingCatalog?.nums[String(item.numbering!.numId)];
		expect(instance?.levelOverrides?.[0]?.startOverride).toBe(3);
	});

	it('numbers only the first paragraph of a list item and indents the ones after it', async () => {
		const para = (t: string): RichNode => ({
			type: 'paragraph',
			attrs: { todo: null },
			content: [text(t)],
		});
		const { bytes } = await exportPageToDocx({
			title: 'Items',
			items: [
				{
					kind: 'text',
					x: 0,
					y: 0,
					blocks: [
						{
							type: 'ordered_list',
							attrs: { order: 1 },
							content: [
								{ type: 'list_item', content: [para('first'), para('more of the first')] },
								{ type: 'list_item', content: [para('second')] },
							],
						},
					],
				},
			],
		});
		const loaded = await loadDocx(bytes);
		const byText = (t: string) => paragraphs(loaded.model).find((p) => textOf(p) === t)!;
		expect(byText('first').numbering?.level).toBe(0);
		expect(byText('more of the first').numbering).toBeUndefined();
		expect(byText('more of the first').indentLeftTwips).toBe(720);
		expect(byText('second').numbering?.numId).toBe(byText('first').numbering?.numId);
	});

	it('starts a nested numbered list at its number, on the level its items use', async () => {
		const para = (t: string): RichNode => ({
			type: 'paragraph',
			attrs: { todo: null },
			content: [text(t)],
		});
		const list = (type: string, order: number | null, ...items: RichNode[][]): RichNode => ({
			type,
			...(order === null ? {} : { attrs: { order } }),
			content: items.map((content) => ({ type: 'list_item', content })),
		});
		const { bytes } = await exportPageToDocx({
			title: 'Nested',
			items: [
				{
					kind: 'text',
					x: 0,
					y: 0,
					blocks: [
						list('bullet_list', null, [para('bullet'), list('ordered_list', 5, [para('fifth')])]),
						list('ordered_list', 1, [para('one'), list('ordered_list', 2, [para('second')])]),
					],
				},
			],
		});
		const loaded = await loadDocx(bytes);
		const start = (name: string): [number, number | null] => {
			const { numId, level } = paragraphs(loaded.model).find((p) => textOf(p) === name)!.numbering!;
			const instance = loaded.model.numberingCatalog?.nums[String(numId)];
			return [level, instance?.levelOverrides?.[level]?.startOverride ?? null];
		};
		expect(start('fifth')).toEqual([1, 5]);
		expect(start('second')).toEqual([1, 2]);
		expect(start('one')).toEqual([0, null]);
	});

	it('reports a text box that holds more than the limit', async () => {
		const { report } = await exportPageToDocx({
			title: 'Long',
			items: [
				{
					kind: 'text',
					x: 0,
					y: 0,
					blocks: [{ type: 'paragraph', attrs: { todo: null }, content: [text('start')] }],
					overLimit: true,
				},
			],
		});
		expect(report.skipped).toEqual([{ kind: 'text', reason: 'text-over-limit' }]);
	});
});
