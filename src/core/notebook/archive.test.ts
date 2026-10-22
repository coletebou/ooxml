import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createIdGenerator } from '../collab/identity';
import { NotebookArchiveError, exportNotebookArchive, importNotebookArchive } from './archive';
import { addFile, addImage, addStroke, addText } from './canvas';
import { NOTEBOOK_ORIGIN, NOTEBOOK_SEED_ORIGIN, notebookTypes } from './schema';
import { overLimit, readSnapshot, writeSnapshot } from './snapshot';
import { MAX_INK_POINTS } from './ink';
import { type NotebookEditContext, addPage, addSection, deletePage, writeMeta } from './structure';

const context = (origin: unknown = NOTEBOOK_ORIGIN, client = 'a'): NotebookEditContext => ({
	types: notebookTypes(new Y.Doc()),
	newId: createIdGenerator(client, 'nb'),
	now: () => 1_700_000_000_000,
	origin,
});

function sample(): NotebookEditContext {
	const ctx = context();
	writeMeta(ctx, { name: 'Trip', color: '#86cdbd' });
	const group = addSection(ctx, { kind: 'group', name: 'Plans' });
	const section = addSection(ctx, { name: 'Days', parentId: group, color: '#ee9a9a' });
	const page = addPage(ctx, { sectionId: section, title: 'Day one' });
	addPage(ctx, { sectionId: section, title: 'Morning', afterId: page, level: 1 });
	const gone = addPage(ctx, { sectionId: section, title: 'Deleted' });
	deletePage(ctx, gone);
	addText(ctx, page, {
		x: 10,
		y: 20,
		width: 300,
		content: [
			{
				type: 'heading',
				attrs: { level: 1, todo: null },
				content: [{ type: 'text', text: 'Pack' }],
			},
			{
				type: 'paragraph',
				attrs: { todo: 'open' },
				content: [{ type: 'text', text: 'Passport', marks: [{ type: 'bold' }] }],
			},
		],
	});
	addImage(ctx, page, {
		x: 400,
		y: 20,
		width: 120,
		height: 80,
		name: 'map.png',
		mime: 'image/png',
		alt: 'Map',
		bytes: new Uint8Array([1, 2, 3]),
	});
	addFile(ctx, page, {
		x: 0,
		y: 300,
		width: 400,
		height: 300,
		name: 'Budget.xlsx',
		mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		bytes: new Uint8Array([4, 5]),
	});
	addStroke(ctx, page, {
		tool: 'highlighter',
		color: '#f5d26b',
		width: 12,
		points: [0, 0, 0.5, 40, 0, 0.5],
	});
	return ctx;
}

/** A snapshot without ids that an import is free to mint again. */
const comparable = (ctx: NotebookEditContext) => {
	const s = readSnapshot(ctx);
	return {
		...s,
		containers: s.containers.map(({ container: { id: _id, ...c }, ...rest }) => ({
			...c,
			...rest,
		})),
		strokes: s.strokes.map(({ id: _id, ...st }) => st),
	};
};

describe('notebook archive', () => {
	it('round-trips structure, text, pictures, files and ink, leaving deleted pages out', async () => {
		const source = sample();
		const bytes = await exportNotebookArchive(readSnapshot(source));
		const zip = await JSZip.loadAsync(bytes);
		expect(Object.keys(zip.files).sort()).toEqual(expect.arrayContaining(['notebook.json']));
		expect(
			Object.keys(zip.files).filter((n) => n.startsWith('media/') && !zip.files[n]!.dir),
		).toHaveLength(2);
		const manifest = JSON.parse(await zip.file('notebook.json')!.async('string'));
		expect(manifest).toMatchObject({
			format: 'ooxml-notebook',
			version: 1,
			notebook: { name: 'Trip' },
		});
		expect(manifest.pages.map((p: { title: string }) => p.title)).toEqual(['Day one', 'Morning']);

		const imported = context(NOTEBOOK_SEED_ORIGIN, 'b');
		expect(writeSnapshot(imported, await importNotebookArchive(bytes))).toBe(0);
		expect(comparable(imported)).toEqual(comparable(source));
	});

	it('rejects what is not a notebook archive', async () => {
		const empty = await new JSZip().generateAsync({ type: 'uint8array' });
		await expect(importNotebookArchive(empty)).rejects.toThrow(NotebookArchiveError);
		const wrong = new JSZip();
		wrong.file('notebook.json', JSON.stringify({ format: 'other' }));
		await expect(
			importNotebookArchive(await wrong.generateAsync({ type: 'uint8array' })),
		).rejects.toThrow('unknown format');
		const newer = new JSZip();
		newer.file('notebook.json', JSON.stringify({ format: 'ooxml-notebook', version: 99 }));
		await expect(
			importNotebookArchive(await newer.generateAsync({ type: 'uint8array' })),
		).rejects.toThrow('newer version');
		const broken = new JSZip();
		broken.file('notebook.json', '{');
		await expect(
			importNotebookArchive(await broken.generateAsync({ type: 'uint8array' })),
		).rejects.toThrow('not valid JSON');
		await expect(importNotebookArchive(new Uint8Array([1, 2, 3]))).rejects.toThrow();
	});

	it('re-validates every value of a hostile manifest', async () => {
		const zip = new JSZip();
		zip.file('secret.txt', 'not media');
		zip.file(
			'notebook.json',
			JSON.stringify({
				format: 'ooxml-notebook',
				version: 1,
				notebook: { name: '<img src=x onerror=alert(1)>Evil', color: 'url(javascript:1)' },
				sections: [
					{ id: 's1', kind: 'section', name: 'S', color: '#zzzzzz', order: 'x' },
					{ id: '../bad' },
				],
				pages: [{ id: 'p1', sectionId: 's1', title: 'T'.repeat(5000), level: 9 }],
				containers: [
					{
						id: 'c1',
						pageId: 'p1',
						kind: 'text',
						x: 1e12,
						y: -1e12,
						content: [{ type: 'script', content: [{ type: 'text', text: 'x' }] }],
					},
				],
				ink: [{ id: 'i1', pageId: 'p1', points: [1, 2, 'x', 4], color: 'red', width: 1e9 }],
			}),
		);
		const snapshot = await importNotebookArchive(await zip.generateAsync({ type: 'uint8array' }));
		expect(snapshot.name).toBe('Evil');
		expect(snapshot.color).toMatch(/^#[0-9a-f]{6}$/u);
		expect(snapshot.sections.map((s) => [s.id, s.color.startsWith('#')])).toEqual([['s1', true]]);
		expect(snapshot.pages[0]).toMatchObject({ level: 0 });
		expect(snapshot.pages[0]?.title.length).toBe(300);
		// Media outside media/ and missing media are never read.
		expect(snapshot.containers.map((c) => c.container.id)).toEqual(['c1']);
		expect(snapshot.strokes[0]?.width).toBe(64);
		const target = context(NOTEBOOK_SEED_ORIGIN);
		writeSnapshot(target, snapshot);
		const read = readSnapshot(target);
		expect(read.containers[0]?.container).toMatchObject({ x: 100_000, y: -100_000 });
		expect(read.containers[0]?.content).toEqual([
			{ type: 'paragraph', attrs: { todo: null }, content: [{ type: 'text', text: 'x' }] },
		]);
	});

	it('writes a large notebook without scanning it again for every item', () => {
		const source = context();
		const section = addSection(source, { name: 'Ink' });
		const pages = [
			addPage(source, { sectionId: section }),
			addPage(source, { sectionId: section }),
		];
		for (let i = 0; i < 300; i++) {
			const page = pages[i % 2]!;
			addStroke(source, page, {
				tool: 'pen',
				color: '#000000',
				width: 2,
				points: [i, 0, 0.5, i, 9, 0.5],
			});
			addText(source, page, { x: i, y: i, content: [] });
		}
		const snapshot = readSnapshot(source);
		const target = context(NOTEBOOK_SEED_ORIGIN, 'b');
		const inkScans = vi.spyOn(target.types.ink, 'forEach');
		const boxScans = vi.spyOn(target.types.containers, 'forEach');
		expect(writeSnapshot(target, snapshot)).toBe(0);
		expect([inkScans.mock.calls.length, boxScans.mock.calls.length]).toEqual([1, 1]);
		inkScans.mockRestore();
		boxScans.mockRestore();
		// Still drawn and stacked in the same order.
		const read = readSnapshot(target);
		for (const page of pages) {
			const firstX = (strokes: typeof read.strokes) =>
				strokes.filter((s) => s.pageId === page).map((s) => s.points[0]);
			expect(firstX(read.strokes)).toEqual(firstX(snapshot.strokes));
			const order = (items: typeof read.containers) =>
				items
					.filter((c) => c.container.pageId === page)
					.sort((a, b) => a.container.z - b.container.z)
					.map((c) => c.container.x);
			expect(order(read.containers)).toEqual(order(snapshot.containers));
		}
	});

	it('reads stroke points as whole triples, so one bad value never shifts the rest', async () => {
		const zip = new JSZip();
		zip.file(
			'notebook.json',
			JSON.stringify({
				format: 'ooxml-notebook',
				version: 1,
				// JSON writes a NaN pressure as null; a point without a position is left out.
				ink: [
					{ id: 's1', pageId: 'p1', points: [10, 20, null, 30, 40, 0.5, 'x', 1, 0.2, 50, 60, 0.7] },
				],
			}),
		);
		const snapshot = await importNotebookArchive(await zip.generateAsync({ type: 'uint8array' }));
		expect(snapshot.strokes[0]?.points).toEqual([10, 20, 0.5, 30, 40, 0.5, 50, 60, 0.7]);
	});

	it('reads a media entry once and keeps the total within a budget', async () => {
		const zip = new JSZip();
		zip.file('media/a.png', new Uint8Array([1, 2, 3]));
		const image = (id: string) => ({
			id,
			pageId: 'p1',
			kind: 'image',
			media: 'media/a.png',
			name: 'a.png',
			mime: 'image/png',
		});
		zip.file(
			'notebook.json',
			JSON.stringify({
				format: 'ooxml-notebook',
				version: 1,
				sections: [{ id: 's1', kind: 'section', name: 'S' }],
				pages: [{ id: 'p1', sectionId: 's1', title: 'P' }],
				containers: [image('c1'), image('c2')],
			}),
		);
		const bytes = await zip.generateAsync({ type: 'uint8array' });
		const ok = await importNotebookArchive(bytes, { maxMediaBytes: 6 });
		expect(ok.containers.map((c) => c.bytes)).toEqual([
			new Uint8Array([1, 2, 3]),
			new Uint8Array([1, 2, 3]),
		]);
		await expect(importNotebookArchive(bytes, { maxMediaBytes: 5 })).rejects.toThrow('more media');
	});

	it('refuses an archive or a notebook with more items than an archive holds, instead of cutting it', async () => {
		const zip = new JSZip();
		const many = Array.from({ length: 500_001 }, () => ({}));
		zip.file(
			'notebook.json',
			JSON.stringify({ format: 'ooxml-notebook', version: 1, sections: many }),
		);
		await expect(
			importNotebookArchive(await zip.generateAsync({ type: 'uint8array' })),
		).rejects.toThrow(NotebookArchiveError);
		const snapshot = {
			name: 'N',
			color: '#202020',
			created: 0,
			sections: [],
			pages: [],
			containers: [],
			strokes: many,
		} as never;
		await expect(exportNotebookArchive(snapshot)).rejects.toThrow(NotebookArchiveError);
	});

	it('exports only what it can import again: size, text and stroke length', async () => {
		const base = { name: 'N', color: '#202020', created: 0, sections: [], pages: [], strokes: [] };
		const container = {
			id: 'c1',
			pageId: 'p1',
			kind: 'file',
			name: 'a.bin',
			mime: 'application/octet-stream',
			x: 0,
			y: 0,
			width: 1,
			height: 1,
			z: 0,
		};
		const huge = { length: 600 * 1024 * 1024 } as unknown as Uint8Array;
		await expect(
			exportNotebookArchive({ ...base, containers: [{ container, bytes: huge }] } as never),
		).rejects.toThrow(NotebookArchiveError);
		await expect(
			exportNotebookArchive({
				...base,
				containers: [{ container: { ...container, kind: 'text' }, content: [], overLimit: true }],
			} as never),
		).rejects.toThrow(NotebookArchiveError);
		// A picture or file whose bytes are not here would make an archive no import opens.
		for (const kind of ['file', 'image'])
			await expect(
				exportNotebookArchive({
					...base,
					containers: [{ container: { ...container, kind }, bytes: null }],
				} as never),
			).rejects.toThrow('not on this device');
		const zip = new JSZip();
		const points = Array.from({ length: (MAX_INK_POINTS + 1) * 3 }, () => 1);
		zip.file(
			'notebook.json',
			JSON.stringify({
				format: 'ooxml-notebook',
				version: 1,
				ink: [{ id: 's1', pageId: 'p1', points }],
			}),
		);
		await expect(
			importNotebookArchive(await zip.generateAsync({ type: 'uint8array' })),
		).rejects.toThrow(NotebookArchiveError);
	});

	it('refuses an archive whose pictures or files are missing or outside its media', async () => {
		for (const media of ['secret.txt', 'media/missing.png']) {
			const zip = new JSZip();
			zip.file('secret.txt', 'not media');
			zip.file(
				'notebook.json',
				JSON.stringify({
					format: 'ooxml-notebook',
					version: 1,
					sections: [{ id: 's1', name: 'S' }],
					pages: [{ id: 'p1', sectionId: 's1' }],
					containers: [{ id: 'c1', pageId: 'p1', kind: 'image', media, name: 'a.png' }],
				}),
			);
			await expect(
				importNotebookArchive(await zip.generateAsync({ type: 'uint8array' })),
			).rejects.toThrow(NotebookArchiveError);
		}
	});

	it('flags a text box with more nodes than a text box holds', () => {
		const doc = new Y.Doc();
		const fragment = doc.getXmlFragment('t');
		fragment.insert(
			0,
			Array.from({ length: 100_001 }, () => new Y.XmlElement('paragraph')),
		);
		expect(overLimit(fragment)).toBe(true);
		expect(overLimit(doc.getXmlFragment('small'))).toBe(false);
	});
});
