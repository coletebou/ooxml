import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createIdGenerator } from '../collab/identity';
import { NotebookArchiveError, exportNotebookArchive, importNotebookArchive } from './archive';
import { addFile, addImage, addStroke, addText } from './canvas';
import { NOTEBOOK_ORIGIN, NOTEBOOK_SEED_ORIGIN, notebookTypes } from './schema';
import { readSnapshot, writeSnapshot } from './snapshot';
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
					{ id: 'c2', pageId: 'p1', kind: 'image', media: 'secret.txt', name: 'a.png' },
					{ id: 'c3', pageId: 'p1', kind: 'image', media: 'media/missing.png' },
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
});
