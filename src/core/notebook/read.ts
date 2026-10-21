// Reading the shared notebook back as plain, re-validated entities. Structure is resolved the same
// way on every peer: a section whose group is missing sits at the top, groups caught in a cycle by
// concurrent moves sit at the top, anything under a deleted group counts as deleted, and a page can
// only be a subpage of the page above it. New code.
import type * as Y from 'yjs';
import {
	type Container,
	type InkStroke,
	type PageEntry,
	type SectionEntry,
	MAX_CONTAINER_WIDTH,
	MAX_COORDINATE,
	MAX_FILE_BYTES,
	MIN_CONTAINER_WIDTH,
	NOTEBOOK_SCHEMA_VERSION,
	byOrder,
	clampNumber,
	isEntityId,
	isFiniteNumber,
	sanitizeFileName,
	sanitizeHexColor,
	sanitizeLevel,
	sanitizeLine,
	sanitizeMime,
	sanitizeName,
	sanitizeTimestamp,
	sanitizeTitle,
} from './model';
import { detectOfficeKind } from '../opc/office-kind';
import { decodeInkPoints } from './ink';
import { paletteColor } from './palette';
import { type NotebookTypes, entityMaps } from './schema';

export interface NotebookMeta {
	version: number;
	name: string;
	color: string;
	created: number;
}

export function readMeta(types: NotebookTypes): NotebookMeta {
	const { meta } = types;
	const version = meta.get('v');
	return {
		version: isFiniteNumber(version) ? version : NOTEBOOK_SCHEMA_VERSION,
		name: sanitizeName(meta.get('name'), 'Notebook'),
		color: sanitizeHexColor(meta.get('color'), paletteColor(0)),
		created: sanitizeTimestamp(meta.get('created')),
	};
}

const deletedOf = (map: Y.Map<unknown>): { deleted?: number } => {
	const deleted = sanitizeTimestamp(map.get('deleted'));
	return deleted ? { deleted } : {};
};

/** Every section and group, including deleted ones, with parents resolved. */
export function readSections(types: NotebookTypes): SectionEntry[] {
	const raw = entityMaps(types.sections)
		.filter(([id]) => isEntityId(id))
		.map(([id, map], index): SectionEntry => {
			const kind = map.get('kind') === 'group' ? 'group' : 'section';
			const parent = map.get('parent');
			return {
				id,
				kind,
				name: sanitizeName(map.get('name'), kind === 'group' ? 'Section group' : 'Section'),
				color: sanitizeHexColor(map.get('color'), paletteColor(index)),
				parentId: isEntityId(parent) ? parent : '',
				order: isFiniteNumber(map.get('order')) ? (map.get('order') as number) : 0,
				created: sanitizeTimestamp(map.get('created')),
				...deletedOf(map),
			};
		});
	const groups = new Map(raw.filter((s) => s.kind === 'group').map((s) => [s.id, s]));
	for (const entry of raw) {
		if (entry.parentId && !groups.has(entry.parentId)) entry.parentId = '';
	}
	// A cycle (A moved into B while B moved into A) puts every group on it at the top. Members are
	// found before anything changes, so the result never depends on the order entries are read in.
	const onCycle = new Set<string>();
	for (const entry of raw) {
		const seen = new Set<string>();
		for (let at = entry.parentId; at && !seen.has(at); at = groups.get(at)?.parentId ?? '') {
			if (at === entry.id) {
				onCycle.add(entry.id);
				break;
			}
			seen.add(at);
		}
	}
	for (const entry of raw) if (onCycle.has(entry.id)) entry.parentId = '';
	return raw.sort(byOrder);
}

/** Ids of sections and groups that are deleted themselves or sit under a deleted group. */
export function deletedSectionIds(sections: readonly SectionEntry[]): Set<string> {
	const byId = new Map(sections.map((s) => [s.id, s]));
	const out = new Set<string>();
	for (const entry of sections) {
		let at: SectionEntry | undefined = entry;
		for (let depth = 0; at && depth < 64; depth++) {
			if (at.deleted) {
				out.add(entry.id);
				break;
			}
			at = at.parentId ? byId.get(at.parentId) : undefined;
		}
	}
	return out;
}

/** Every page, including deleted ones, in section order. */
export function readPages(types: NotebookTypes): PageEntry[] {
	return entityMaps(types.pages)
		.filter(([id, map]) => isEntityId(id) && isEntityId(map.get('section')))
		.map(([id, map]): PageEntry => ({
			id,
			sectionId: map.get('section') as string,
			title: sanitizeTitle(map.get('title')),
			created: sanitizeTimestamp(map.get('created')),
			order: isFiniteNumber(map.get('order')) ? (map.get('order') as number) : 0,
			level: sanitizeLevel(map.get('level')),
			...deletedOf(map),
		}))
		.sort(byOrder);
}

/** The visible pages of one section in order, with levels made valid (no orphan subpages). */
export function sectionPages(pages: readonly PageEntry[], sectionId: string): PageEntry[] {
	const out: PageEntry[] = [];
	let previous = -1;
	for (const page of pages) {
		if (page.sectionId !== sectionId || page.deleted) continue;
		const level = Math.min(page.level, previous + 1, 2) as PageEntry['level'];
		out.push(level === page.level ? page : { ...page, level });
		previous = level;
	}
	return out;
}

const coordinate = (value: unknown): number =>
	clampNumber(value, -MAX_COORDINATE, MAX_COORDINATE, 0);

function readContainer(id: string, map: Y.Map<unknown>): Container | undefined {
	const pageId = map.get('page');
	if (!isEntityId(id) || !isEntityId(pageId)) return undefined;
	const base = {
		id,
		pageId,
		x: coordinate(map.get('x')),
		y: coordinate(map.get('y')),
		width: clampNumber(map.get('w'), MIN_CONTAINER_WIDTH, MAX_CONTAINER_WIDTH, 320),
		z: clampNumber(map.get('z'), -1e9, 1e9, 0),
	};
	const kind = map.get('kind');
	if (kind === 'text') return { ...base, kind, height: 0 };
	const height = clampNumber(map.get('h'), 16, MAX_COORDINATE, 200);
	if (kind === 'image') {
		return {
			...base,
			kind,
			height,
			name: sanitizeFileName(map.get('name'), 'picture'),
			mime: sanitizeMime(map.get('mime'), 'image/png'),
			alt: sanitizeLine(map.get('alt'), 500),
		};
	}
	if (kind === 'file') {
		const name = sanitizeFileName(map.get('name'));
		const mime = sanitizeMime(map.get('mime'));
		return {
			...base,
			kind,
			height,
			name,
			mime,
			size: clampNumber(map.get('size'), 0, MAX_FILE_BYTES, 0),
			office: detectOfficeKind(name, mime),
		};
	}
	return undefined;
}

/** Containers of one page (or all pages), bottom to top. */
export function readContainers(types: NotebookTypes, pageId?: string): Container[] {
	const out: Container[] = [];
	for (const [id, map] of entityMaps(types.containers)) {
		if (pageId !== undefined && map.get('page') !== pageId) continue;
		const container = readContainer(id, map);
		if (container) out.push(container);
	}
	return out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function readStroke(id: string, value: unknown): InkStroke | undefined {
	if (!isEntityId(id) || !value || typeof value !== 'object') return undefined;
	const raw = value as Record<string, unknown>;
	if (!isEntityId(raw.page)) return undefined;
	const points = decodeInkPoints(raw.pts);
	if (points.length < 3) return undefined;
	return {
		id,
		pageId: raw.page,
		tool: raw.tool === 'highlighter' ? 'highlighter' : 'pen',
		color: sanitizeHexColor(raw.color, '#202020'),
		width: clampNumber(raw.width, 0.5, 64, 2),
		points,
	};
}

/** Ink strokes of one page (or all pages), oldest first. */
export function readStrokes(types: NotebookTypes, pageId?: string): InkStroke[] {
	const out: InkStroke[] = [];
	const order = new Map<string, number>();
	types.ink.forEach((value, id) => {
		if (pageId !== undefined && (value as { page?: unknown } | null)?.page !== pageId) return;
		const stroke = readStroke(id, value);
		if (!stroke) return;
		out.push(stroke);
		const seq = (value as { seq?: unknown }).seq;
		if (typeof seq === 'number' && Number.isFinite(seq)) order.set(id, seq);
	});
	// The stored drawing order first (strokes from before it existed come first, by id counter).
	const rank = (s: InkStroke): number => order.get(s.id) ?? 0;
	return out.sort(
		(a, b) => rank(a) - rank(b) || strokeSeq(a.id) - strokeSeq(b.id) || (a.id < b.id ? -1 : 1),
	);
}

// Stroke ids end in a per-client counter (`createIdGenerator`); within one client that is the
// drawing order, across clients ties fall back to the id.
const strokeSeq = (id: string): number => Number(/-(\d+)$/u.exec(id)?.[1] ?? 0);
