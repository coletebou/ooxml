import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createIdGenerator } from '../collab/identity';
import { deletedSectionIds, readPages, readSections, sectionPages } from './read';
import { NOTEBOOK_ORIGIN, notebookTypes } from './schema';
import {
	type NotebookEditContext,
	addPage,
	addSection,
	deletePage,
	deleteSection,
	movePage,
	moveSection,
	renamePage,
	restoreBatch,
	shiftPageLevel,
	updateSection,
	writeMeta,
} from './structure';
import { readMeta } from './read';
import { pageViews, sectionViews } from './views';

const context = (doc = new Y.Doc(), client = 'a'): NotebookEditContext => ({
	types: notebookTypes(doc),
	newId: createIdGenerator(client, 'nb'),
	now: () => 1_700_000_000_000,
	origin: NOTEBOOK_ORIGIN,
});
const sync = (a: Y.Doc, b: Y.Doc): void => {
	Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
	Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
};
const names = (ctx: NotebookEditContext): string[] =>
	sectionViews(readSections(ctx.types), readPages(ctx.types)).map(
		(s) => `${'-'.repeat(s.depth)}${s.name}`,
	);
const titles = (ctx: NotebookEditContext, section: string): string[] =>
	sectionPages(readPages(ctx.types), section).map((p) => `${p.level}:${p.title}`);

describe('notebook structure', () => {
	it('writes metadata with a version and creation time once', () => {
		const ctx = context();
		writeMeta(ctx, { name: '  Work <b>notes</b> ', color: '#ABCDEF' });
		writeMeta(ctx, { color: 'red' });
		expect(readMeta(ctx.types)).toEqual({
			version: 1,
			name: 'Work notes',
			color: '#abcdef',
			created: 1_700_000_000_000,
		});
	});

	it('adds, orders, nests, renames and recolours sections', () => {
		const ctx = context();
		const a = addSection(ctx, { name: 'A' });
		const group = addSection(ctx, { kind: 'group', name: 'G' });
		const c = addSection(ctx, { name: 'C', beforeId: a });
		addSection(ctx, { name: 'Inner', parentId: group });
		addSection(ctx, { name: 'Ignored parent', parentId: a });
		expect(names(ctx)).toEqual(['C', 'A', 'G', '-Inner', 'Ignored parent']);
		updateSection(ctx, c, { name: 'Renamed', color: '#112233' });
		const renamed = readSections(ctx.types).find((s) => s.id === c);
		expect(renamed).toMatchObject({ name: 'Renamed', color: '#112233' });
		expect(moveSection(ctx, c, { parentId: group })).toBe(true);
		expect(names(ctx)).toEqual(['A', 'G', '-Inner', '-Renamed', 'Ignored parent']);
	});

	it('refuses to move a group into itself and breaks cycles made by concurrent moves', () => {
		const one = new Y.Doc();
		const a = context(one, 'a');
		const g1 = addSection(a, { kind: 'group', name: 'G1' });
		const g2 = addSection(a, { kind: 'group', name: 'G2' });
		expect(moveSection(a, g1, { parentId: g1 })).toBe(false);
		const two = new Y.Doc();
		sync(one, two);
		const b = context(two, 'b');
		moveSection(a, g1, { parentId: g2 });
		moveSection(b, g2, { parentId: g1 });
		sync(one, two);
		for (const ctx of [a, b]) expect(names(ctx).sort()).toEqual(['G1', 'G2']);
	});

	it('adds pages and subpages after the right page and moves a page with its subpages', () => {
		const ctx = context();
		const s = addSection(ctx, { name: 'S' });
		const t = addSection(ctx, { name: 'T' });
		const p1 = addPage(ctx, { sectionId: s, title: 'One' });
		const p2 = addPage(ctx, { sectionId: s, title: 'Two' });
		addPage(ctx, { sectionId: s, title: 'One sub', afterId: p1, level: 1 });
		addPage(ctx, { sectionId: s, title: 'After one', afterId: p1 });
		expect(titles(ctx, s)).toEqual(['0:One', '1:One sub', '0:After one', '0:Two']);
		expect(addPage(ctx, { sectionId: 'missing' })).toBe('');
		expect(movePage(ctx, p1, { sectionId: t })).toBe(true);
		expect(titles(ctx, s)).toEqual(['0:After one', '0:Two']);
		expect(titles(ctx, t)).toEqual(['0:One', '1:One sub']);
		movePage(ctx, p2, { sectionId: t, beforeId: p1 });
		expect(titles(ctx, t)).toEqual(['0:Two', '0:One', '1:One sub']);
		renamePage(ctx, p2, '  Second\n page ');
		expect(titles(ctx, t)[0]).toBe('0:Second page');
	});

	it('indents and promotes pages, never deeper than the page above allows', () => {
		const ctx = context();
		const s = addSection(ctx, { name: 'S' });
		const first = addPage(ctx, { sectionId: s, title: 'A' });
		const second = addPage(ctx, { sectionId: s, title: 'B' });
		const third = addPage(ctx, { sectionId: s, title: 'C' });
		expect(shiftPageLevel(ctx, first, 1)).toBe(false);
		expect(shiftPageLevel(ctx, second, 1)).toBe(true);
		expect(shiftPageLevel(ctx, third, 1)).toBe(true);
		expect(shiftPageLevel(ctx, third, 1)).toBe(true);
		expect(shiftPageLevel(ctx, third, 1)).toBe(false);
		expect(titles(ctx, s)).toEqual(['0:A', '1:B', '2:C']);
		// Promoting B takes C along.
		shiftPageLevel(ctx, second, -1);
		expect(titles(ctx, s)).toEqual(['0:A', '0:B', '1:C']);
		expect(pageViews(readPages(ctx.types), s).map((p) => p.hasSubpages)).toEqual([
			false,
			true,
			false,
		]);
	});

	it('soft-deletes a page with its subpages and restores exactly that batch', () => {
		const ctx = context();
		const s = addSection(ctx, { name: 'S' });
		const a = addPage(ctx, { sectionId: s, title: 'A' });
		addPage(ctx, { sectionId: s, title: 'A1', afterId: a, level: 1 });
		const b = addPage(ctx, { sectionId: s, title: 'B' });
		const batch = deletePage(ctx, a)!;
		const other = deletePage(ctx, b)!;
		expect(titles(ctx, s)).toEqual([]);
		expect(restoreBatch(ctx, batch)).toBe(true);
		expect(titles(ctx, s)).toEqual(['0:A', '1:A1']);
		expect(deletePage(ctx, a)).not.toBeNull();
		expect(restoreBatch(ctx, other)).toBe(true);
		expect(titles(ctx, s)).toEqual(['0:B']);
	});

	it('hides what is inside a deleted group and brings it back on restore', () => {
		const ctx = context();
		const g = addSection(ctx, { kind: 'group', name: 'G' });
		const inner = addSection(ctx, { name: 'Inner', parentId: g });
		const batch = deleteSection(ctx, g)!;
		expect(deletedSectionIds(readSections(ctx.types))).toEqual(new Set([g, inner]));
		expect(names(ctx)).toEqual([]);
		expect(deleteSection(ctx, g)).toBeNull();
		restoreBatch(ctx, batch);
		expect(names(ctx)).toEqual(['G', '-Inner']);
	});

	it('converges when two peers add and reorder pages at once', () => {
		const one = new Y.Doc();
		const a = context(one, 'a');
		const s = addSection(a, { name: 'S' });
		const p1 = addPage(a, { sectionId: s, title: 'P1' });
		const p2 = addPage(a, { sectionId: s, title: 'P2' });
		const two = new Y.Doc();
		sync(one, two);
		const b = context(two, 'b');
		addPage(a, { sectionId: s, title: 'From A' });
		addPage(b, { sectionId: s, title: 'From B' });
		movePage(b, p2, { sectionId: s, beforeId: p1 });
		sync(one, two);
		expect(titles(a, s)).toEqual(titles(b, s));
		expect(titles(a, s).slice(0, 2)).toEqual(['0:P2', '0:P1']);
		expect(titles(a, s)).toHaveLength(4);
	});

	it('ignores entities a peer wrote with the wrong shape', () => {
		const ctx = context();
		ctx.types.sections.set('bad id!', new Y.Map());
		ctx.types.sections.set('plain', 'not a map' as never);
		const pages = new Y.Map<unknown>();
		ctx.types.pages.set('orphan', pages);
		pages.set('section', 123);
		expect(readSections(ctx.types)).toEqual([]);
		expect(readPages(ctx.types)).toEqual([]);
	});

	it('keeps subpage levels when reordering inside a section', () => {
		const ctx = context();
		const s = addSection(ctx, { name: 'S' });
		const a = addPage(ctx, { sectionId: s, title: 'A' });
		const a1 = addPage(ctx, { sectionId: s, title: 'A1', afterId: a, level: 1 });
		const a2 = addPage(ctx, { sectionId: s, title: 'A2', afterId: a1, level: 1 });
		expect(titles(ctx, s)).toEqual(['0:A', '1:A1', '1:A2']);
		movePage(ctx, a2, { sectionId: s, beforeId: a1 });
		expect(titles(ctx, s)).toEqual(['0:A', '1:A2', '1:A1']);
	});

	it("does not move a page into another page's subpages", () => {
		const ctx = context();
		const s = addSection(ctx, { name: 'S' });
		const a = addPage(ctx, { sectionId: s, title: 'A' });
		const a1 = addPage(ctx, { sectionId: s, title: 'A1', afterId: a, level: 1 });
		const b = addPage(ctx, { sectionId: s, title: 'B', afterId: a1, level: 0 });
		movePage(ctx, b, { sectionId: s, beforeId: a1 });
		expect(titles(ctx, s)).toEqual(['0:A', '1:A1', '0:B']);
	});
});
