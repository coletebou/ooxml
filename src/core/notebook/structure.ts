// Commands on the notebook's structure: section groups, sections and pages. Each command is one
// transaction under the caller's origin (local edits are undoable, seeding is not). Deletes are
// soft (a timestamp and a trash batch id), so a restore brings back exactly what one delete took,
// and a collaborator's concurrent edit inside a deleted page survives. Orders are fractional and
// minimal (`reorderFractional`), so concurrent moves of different items both apply. New code.
import * as Y from 'yjs';
import { reorderFractional } from '../collab/ordering';
import {
	type PageEntry,
	type PageLevel,
	type SectionKind,
	MAX_PAGE_LEVEL,
	byOrder,
	sanitizeHexColor,
	sanitizeName,
	sanitizeTitle,
} from './model';
import { paletteColor } from './palette';
import { deletedSectionIds, readPages, readSections, sectionPages } from './read';
import { type NotebookTypes, entityMap } from './schema';

export interface NotebookEditContext {
	readonly types: NotebookTypes;
	readonly newId: (kind: string) => string;
	readonly now: () => number;
	/** Transaction origin: `NOTEBOOK_ORIGIN` for undoable edits, `NOTEBOOK_SEED_ORIGIN` otherwise. */
	readonly origin: unknown;
}

const transact = <T>(ctx: NotebookEditContext, fn: () => T): T => {
	let out!: T;
	ctx.types.doc.transact(() => {
		out = fn();
	}, ctx.origin);
	return out;
};

interface Ordered {
	id: string;
	order: number;
	map: Y.Map<unknown>;
}

/** Insert `moving` (in order) before `beforeId` among `siblings`, writing the fewest orders. */
function place(siblings: readonly Ordered[], moving: readonly Ordered[], beforeId?: string): void {
	const ids = new Set(moving.map((m) => m.id));
	const rest = siblings.filter((s) => !ids.has(s.id));
	let at = beforeId ? rest.findIndex((s) => s.id === beforeId) : -1;
	if (at < 0) at = rest.length;
	const sequence = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
	const changes = reorderFractional(sequence.map((s) => (ids.has(s.id) ? undefined : s.order)));
	for (const [index, order] of changes) sequence[index]?.map.set('order', order);
}

function sectionSiblings(ctx: NotebookEditContext, parentId: string): Ordered[] {
	const deleted = deletedSectionIds(readSections(ctx.types));
	return readSections(ctx.types)
		.filter((s) => s.parentId === parentId && !deleted.has(s.id))
		.map((s) => ({ id: s.id, order: s.order, map: entityMap(ctx.types.sections, s.id)! }))
		.filter((s) => s.map);
}

export interface SectionInput {
	kind?: SectionKind;
	name: string;
	color?: string;
	/** Enclosing group, `''` (default) for the top of the notebook. */
	parentId?: string;
	beforeId?: string;
}

/** Add a section or section group; returns its id. */
export function addSection(ctx: NotebookEditContext, input: SectionInput): string {
	return transact(ctx, () => {
		const kind = input.kind ?? 'section';
		const parentId = input.parentId && isGroup(ctx, input.parentId) ? input.parentId : '';
		const siblings = sectionSiblings(ctx, parentId);
		const id = ctx.newId(kind === 'group' ? 'group' : 'section');
		const map = new Y.Map<unknown>();
		ctx.types.sections.set(id, map);
		map.set('kind', kind);
		map.set('name', sanitizeName(input.name, kind === 'group' ? 'Section group' : 'Section'));
		map.set('color', sanitizeHexColor(input.color, paletteColor(ctx.types.sections.size - 1)));
		map.set('parent', parentId);
		map.set('created', ctx.now());
		place(siblings, [{ id, order: 0, map }], input.beforeId);
		return id;
	});
}

function isGroup(ctx: NotebookEditContext, id: string): boolean {
	return entityMap(ctx.types.sections, id)?.get('kind') === 'group';
}

/** Rename or recolour a section or group. */
export function updateSection(
	ctx: NotebookEditContext,
	id: string,
	patch: { name?: string; color?: string },
): boolean {
	const map = entityMap(ctx.types.sections, id);
	if (!map) return false;
	transact(ctx, () => {
		if (patch.name !== undefined)
			map.set('name', sanitizeName(patch.name, String(map.get('name'))));
		if (patch.color !== undefined)
			map.set('color', sanitizeHexColor(patch.color, String(map.get('color'))));
	});
	return true;
}

/** Move a section or group into `parentId` (a group or `''`), before `beforeId` or last. */
export function moveSection(
	ctx: NotebookEditContext,
	id: string,
	target: { parentId: string; beforeId?: string },
): boolean {
	const map = entityMap(ctx.types.sections, id);
	if (!map) return false;
	const parentId = target.parentId && isGroup(ctx, target.parentId) ? target.parentId : '';
	// A group never moves into itself or one of its own descendants.
	const sections = readSections(ctx.types);
	for (let at = parentId; at; at = sections.find((s) => s.id === at)?.parentId ?? '')
		if (at === id) return false;
	transact(ctx, () => {
		map.set('parent', parentId);
		place(sectionSiblings(ctx, parentId), [{ id, order: 0, map }], target.beforeId);
	});
	return true;
}

/** Soft-delete a section or group (with everything in it); returns the trash batch id. */
export function deleteSection(ctx: NotebookEditContext, id: string): string | null {
	const map = entityMap(ctx.types.sections, id);
	if (!map || map.get('deleted')) return null;
	const batch = ctx.newId('trash');
	transact(ctx, () => {
		map.set('deleted', ctx.now());
		map.set('trash', batch);
	});
	return batch;
}

/** Undo a delete: everything that went to the trash in `batch` comes back. */
export function restoreBatch(ctx: NotebookEditContext, batch: string): boolean {
	let restored = false;
	transact(ctx, () => {
		for (const map of [ctx.types.sections, ctx.types.pages])
			map.forEach((value) => {
				if (value instanceof Y.Map && value.get('trash') === batch) {
					value.delete('deleted');
					value.delete('trash');
					restored = true;
				}
			});
	});
	return restored;
}

const pageOrdered = (ctx: NotebookEditContext, page: PageEntry): Ordered => ({
	id: page.id,
	order: page.order,
	map: entityMap(ctx.types.pages, page.id)!,
});

/** A page with the subpages under it, in order. */
function pageBlock(pages: readonly PageEntry[], id: string): PageEntry[] {
	const at = pages.findIndex((p) => p.id === id);
	const head = pages[at];
	if (!head) return [];
	const out = [head];
	for (let i = at + 1; i < pages.length && (pages[i]?.level ?? 0) > head.level; i++)
		out.push(pages[i]!);
	return out;
}

export interface PageInput {
	sectionId: string;
	title?: string;
	/** Insert after this page (after its subpages, unless the new page is one of them). */
	afterId?: string;
	level?: PageLevel;
}

/** Add a page; returns its id, or `''` when the section does not exist. */
export function addPage(ctx: NotebookEditContext, input: PageInput): string {
	const section = entityMap(ctx.types.sections, input.sectionId);
	if (!section || section.get('kind') === 'group') return '';
	return transact(ctx, () => {
		const pages = sectionPages(readPages(ctx.types), input.sectionId);
		const after = pages.find((p) => p.id === input.afterId);
		const level = Math.min(
			input.level ?? after?.level ?? 0,
			(after?.level ?? -1) + 1,
			MAX_PAGE_LEVEL,
		);
		let next: PageEntry | undefined;
		if (after) {
			const block = level > after.level ? [after] : pageBlock(pages, after.id);
			next = pages[pages.indexOf(block[block.length - 1]!) + 1];
		}
		const id = ctx.newId('page');
		const map = new Y.Map<unknown>();
		ctx.types.pages.set(id, map);
		map.set('section', input.sectionId);
		map.set('title', sanitizeTitle(input.title ?? ''));
		map.set('created', ctx.now());
		map.set('level', Math.max(0, level));
		place(
			pages.map((p) => pageOrdered(ctx, p)),
			[{ id, order: 0, map }],
			after ? next?.id : undefined,
		);
		return id;
	});
}

export function renamePage(ctx: NotebookEditContext, id: string, title: string): boolean {
	const map = entityMap(ctx.types.pages, id);
	if (!map) return false;
	const value = sanitizeTitle(title);
	if (map.get('title') !== value) transact(ctx, () => map.set('title', value));
	return true;
}

/** Move a page with its subpages to `sectionId`, before `beforeId` or last. */
export function movePage(
	ctx: NotebookEditContext,
	id: string,
	target: { sectionId: string; beforeId?: string },
): boolean {
	const all = readPages(ctx.types);
	const source = all.find((p) => p.id === id);
	const section = entityMap(ctx.types.sections, target.sectionId);
	if (!source || !section || section.get('kind') === 'group') return false;
	const block = pageBlock(sectionPages(all, source.sectionId), id);
	if (block.some((p) => p.id === target.beforeId)) return false;
	transact(ctx, () => {
		// Levels are relative to the page above: a block entering another section starts at the top
		// level; a reorder inside its section keeps them (reading clamps an impossible spot).
		const shift = target.sectionId === source.sectionId ? 0 : -(block[0]?.level ?? 0);
		for (const page of block) {
			const map = entityMap(ctx.types.pages, page.id)!;
			map.set('section', target.sectionId);
			map.set('level', Math.max(0, page.level + shift));
		}
		const destination = sectionPages(readPages(ctx.types), target.sectionId).filter(
			(p) => !block.some((b) => b.id === p.id),
		);
		place(
			destination.map((p) => pageOrdered(ctx, p)),
			block.map((p) => pageOrdered(ctx, p)),
			target.beforeId,
		);
	});
	return true;
}

/** Make a page (with its subpages) one level deeper (+1) or shallower (-1). */
export function shiftPageLevel(ctx: NotebookEditContext, id: string, delta: 1 | -1): boolean {
	const all = readPages(ctx.types);
	const page = all.find((p) => p.id === id);
	if (!page) return false;
	const pages = sectionPages(all, page.sectionId);
	const index = pages.findIndex((p) => p.id === id);
	const current = pages[index];
	if (!current) return false;
	const max = Math.min(MAX_PAGE_LEVEL, index === 0 ? 0 : (pages[index - 1]?.level ?? 0) + 1);
	const level = Math.max(0, Math.min(max, current.level + delta));
	if (level === current.level) return false;
	transact(ctx, () => {
		for (const p of pageBlock(pages, id))
			entityMap(ctx.types.pages, p.id)?.set(
				'level',
				Math.max(0, Math.min(MAX_PAGE_LEVEL, p.level + level - current.level)),
			);
	});
	return true;
}

/** Soft-delete a page and its subpages; returns the trash batch id. */
export function deletePage(ctx: NotebookEditContext, id: string): string | null {
	const all = readPages(ctx.types);
	const page = all.find((p) => p.id === id && !p.deleted);
	if (!page) return null;
	const batch = ctx.newId('trash');
	transact(ctx, () => {
		for (const p of pageBlock(sectionPages(all, page.sectionId), id)) {
			const map = entityMap(ctx.types.pages, p.id);
			map?.set('deleted', ctx.now());
			map?.set('trash', batch);
		}
	});
	return batch;
}

/** Write the notebook's metadata (name, colour; version and created on the first write). */
export function writeMeta(
	ctx: NotebookEditContext,
	patch: { name?: string; color?: string },
): void {
	transact(ctx, () => {
		const { meta } = ctx.types;
		if (!meta.has('v')) meta.set('v', 1);
		if (!meta.has('created')) meta.set('created', ctx.now());
		const name = meta.get('name');
		const color = meta.get('color');
		if (patch.name !== undefined)
			meta.set('name', sanitizeName(patch.name, typeof name === 'string' ? name : 'Notebook'));
		if (patch.color !== undefined)
			meta.set(
				'color',
				sanitizeHexColor(patch.color, typeof color === 'string' ? color : paletteColor(0)),
			);
	});
}

/** Sections in display order (pre-order through groups), with their depth. */
export function sectionOutline(
	ctx: Pick<NotebookEditContext, 'types'>,
): { id: string; depth: number }[] {
	const sections = readSections(ctx.types).sort(byOrder);
	const out: { id: string; depth: number }[] = [];
	const visit = (parentId: string, depth: number): void => {
		for (const s of sections.filter((x) => x.parentId === parentId)) {
			out.push({ id: s.id, depth });
			if (s.kind === 'group' && depth < 16) visit(s.id, depth + 1);
		}
	};
	visit('', 0);
	return out;
}
