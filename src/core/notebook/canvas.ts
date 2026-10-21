// Commands on a page's canvas: text containers, pictures, embedded files and ink. A container is a
// Y.Map created by one peer; its geometry fields are set individually, so one person moving a
// container while another resizes it keeps both. Picture and file bytes go to the asset map once.
// Strokes are immutable JSON entries; the eraser deletes whole strokes. New code.
import * as Y from 'yjs';
import {
	MAX_CONTAINER_WIDTH,
	MAX_COORDINATE,
	MAX_FILE_BYTES,
	MIN_CONTAINER_WIDTH,
	type InkTool,
	clampNumber,
	isEntityId,
	sanitizeFileName,
	sanitizeHexColor,
	sanitizeLine,
	sanitizeMime,
} from './model';
import { MAX_INK_POINTS, encodeInkPoints, simplifyInk } from './ink';
import { type RichNode, writeRichText } from './rich-text';
import { NOTEBOOK_ASSETS, entityMap } from './schema';
import type { NotebookEditContext } from './structure';

const pos = (v: number): number => Math.round(clampNumber(v, -MAX_COORDINATE, MAX_COORDINATE, 0));
const width = (v: number | undefined, fallback: number): number =>
	Math.round(clampNumber(v, MIN_CONTAINER_WIDTH, MAX_CONTAINER_WIDTH, fallback));

function topZ(ctx: NotebookEditContext, pageId: string): number {
	let z = 0;
	ctx.types.containers.forEach((value) => {
		if (value instanceof Y.Map && value.get('page') === pageId) {
			const current = value.get('z');
			if (typeof current === 'number' && current > z) z = current;
		}
	});
	return z;
}

function newContainer(
	ctx: NotebookEditContext,
	pageId: string,
	kind: 'text' | 'image' | 'file',
	at: { x: number; y: number; width?: number; height?: number },
	defaultWidth: number,
): [string, Y.Map<unknown>] {
	const id = ctx.newId(kind);
	const map = new Y.Map<unknown>();
	ctx.types.containers.set(id, map);
	map.set('page', pageId);
	map.set('kind', kind);
	map.set('x', pos(at.x));
	map.set('y', pos(at.y));
	map.set('w', width(at.width, defaultWidth));
	if (kind !== 'text') map.set('h', Math.round(clampNumber(at.height, 16, MAX_COORDINATE, 200)));
	map.set('z', topZ(ctx, pageId) + 1);
	return [id, map];
}

const transact = (ctx: NotebookEditContext, fn: () => void): void =>
	ctx.types.doc.transact(fn, ctx.origin);

export interface TextInput {
	x: number;
	y: number;
	width?: number;
	/** Initial content; one empty paragraph when omitted. */
	content?: readonly RichNode[];
}

/** Place a text container on a page; returns its id (`''` for an invalid page id). */
export function addText(ctx: NotebookEditContext, pageId: string, input: TextInput): string {
	if (!isEntityId(pageId)) return '';
	let id = '';
	transact(ctx, () => {
		const [newId, map] = newContainer(ctx, pageId, 'text', input, 320);
		const fragment = new Y.XmlFragment();
		map.set('content', fragment);
		writeRichText(fragment, input.content ?? []);
		id = newId;
	});
	return id;
}

export interface BinaryInput {
	x: number;
	y: number;
	width: number;
	height: number;
	name: string;
	mime: string;
	bytes: Uint8Array;
	alt?: string;
}

/** Place a picture; returns its id, or `''` when the bytes are empty or too large. */
export function addImage(ctx: NotebookEditContext, pageId: string, input: BinaryInput): string {
	return addBinary(ctx, pageId, 'image', input);
}

/** Embed a file (an Office document or anything else); returns its id. */
export function addFile(ctx: NotebookEditContext, pageId: string, input: BinaryInput): string {
	return addBinary(ctx, pageId, 'file', input);
}

function addBinary(
	ctx: NotebookEditContext,
	pageId: string,
	kind: 'image' | 'file',
	input: BinaryInput,
): string {
	if (!isEntityId(pageId) || !input.bytes.length || input.bytes.length > MAX_FILE_BYTES) return '';
	let id = '';
	transact(ctx, () => {
		const [newId, map] = newContainer(ctx, pageId, kind, input, input.width);
		map.set('name', sanitizeFileName(input.name, kind === 'image' ? 'picture' : 'file'));
		map.set('mime', sanitizeMime(input.mime));
		if (kind === 'image') map.set('alt', sanitizeLine(input.alt ?? '', 500));
		else map.set('size', input.bytes.length);
		NOTEBOOK_ASSETS.write(newId, { data: input.bytes }, map, ctx.types.assets);
		id = newId;
	});
	return id;
}

/** The bytes of a picture or file container, or `null`. */
export function containerBytes(
	ctx: Pick<NotebookEditContext, 'types'>,
	id: string,
): Uint8Array | null {
	const map = entityMap(ctx.types.containers, id);
	if (!map) return null;
	const target: Record<string, unknown> = {};
	NOTEBOOK_ASSETS.read(map, ctx.types.assets, target);
	return target.data instanceof Uint8Array ? target.data : null;
}

/** Move containers by (dx, dy). */
export function moveContainers(
	ctx: NotebookEditContext,
	ids: readonly string[],
	dx: number,
	dy: number,
): void {
	transact(ctx, () => {
		for (const id of ids) {
			const map = entityMap(ctx.types.containers, id);
			if (!map) continue;
			map.set('x', pos(Number(map.get('x') ?? 0) + dx));
			map.set('y', pos(Number(map.get('y') ?? 0) + dy));
		}
	});
}

/** Put a container at an absolute position. */
export function placeContainer(ctx: NotebookEditContext, id: string, x: number, y: number): void {
	const map = entityMap(ctx.types.containers, id);
	if (map) transact(ctx, () => (map.set('x', pos(x)), map.set('y', pos(y))));
}

/** Resize a container (the height applies to pictures and files only). */
export function resizeContainer(
	ctx: NotebookEditContext,
	id: string,
	size: { width: number; height?: number },
): void {
	const map = entityMap(ctx.types.containers, id);
	if (!map) return;
	transact(ctx, () => {
		map.set('w', width(size.width, Number(map.get('w') ?? 320)));
		if (size.height !== undefined && map.get('kind') !== 'text')
			map.set('h', Math.round(clampNumber(size.height, 16, MAX_COORDINATE, 200)));
	});
}

/** Raise a container above everything else on its page. */
export function bringToFront(ctx: NotebookEditContext, id: string): void {
	const map = entityMap(ctx.types.containers, id);
	const page = map?.get('page');
	if (!map || typeof page !== 'string') return;
	const top = topZ(ctx, page);
	if (map.get('z') !== top || countAtZ(ctx, page, top) > 1)
		transact(ctx, () => map.set('z', top + 1));
}

function countAtZ(ctx: NotebookEditContext, pageId: string, z: number): number {
	let n = 0;
	ctx.types.containers.forEach((v) => {
		if (v instanceof Y.Map && v.get('page') === pageId && v.get('z') === z) n++;
	});
	return n;
}

/**
 * Delete containers. Their asset bytes stay in the asset map (as collab assets do), so undo can
 * bring a picture back; an archive export only carries assets that are still referenced.
 */
export function deleteContainers(ctx: NotebookEditContext, ids: readonly string[]): void {
	transact(ctx, () => {
		for (const id of ids) ctx.types.containers.delete(id);
	});
}

export interface StrokeInput {
	tool: InkTool;
	color: string;
	width: number;
	/** Flat `[x, y, pressure, ...]` in page CSS px. */
	points: readonly number[];
}

/** Add an ink stroke; returns its id, or `''` without enough points. */
export function addStroke(ctx: NotebookEditContext, pageId: string, input: StrokeInput): string {
	const all = simplifyInk(input.points);
	if (!isEntityId(pageId) || all.length < 3) return '';
	// The drawing order is stored: ids end in a per-client counter, which says nothing across
	// sessions or peers. Later strokes get a higher number than any on the page.
	let seq = 0;
	ctx.types.ink.forEach((value) => {
		const raw = value as { page?: unknown; seq?: unknown } | null;
		if (raw?.page === pageId && typeof raw.seq === 'number') seq = Math.max(seq, raw.seq);
	});
	let first = '';
	transact(ctx, () => {
		// A stroke longer than one stored stroke holds becomes several, so none of it is lost.
		for (let at = 0; at < all.length; at += MAX_INK_POINTS * 3) {
			const points = encodeInkPoints(all.slice(at, at + MAX_INK_POINTS * 3));
			if (points.length < 3) continue;
			const id = ctx.newId('ink');
			first ||= id;
			ctx.types.ink.set(id, {
				page: pageId,
				tool: input.tool === 'highlighter' ? 'highlighter' : 'pen',
				color: sanitizeHexColor(input.color, '#202020'),
				width: clampNumber(input.width, 0.5, 64, 2),
				pts: points,
				seq: ++seq,
			});
		}
	});
	return first;
}

/** Erase whole strokes. */
export function deleteStrokes(ctx: NotebookEditContext, ids: readonly string[]): void {
	if (!ids.length) return;
	transact(ctx, () => {
		for (const id of ids) ctx.types.ink.delete(id);
	});
}
