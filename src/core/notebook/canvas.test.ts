import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createIdGenerator } from '../collab/identity';
import {
	addFile,
	addImage,
	addStroke,
	addText,
	bringToFront,
	containerBytes,
	deleteContainers,
	deleteStrokes,
	moveContainers,
	resizeContainer,
} from './canvas';
import {
	decodeInkPoints,
	encodeInkPoints,
	inkBounds,
	inkHits,
	inkOutline,
	MAX_INK_POINTS,
	simplifyInk,
	strokesBounds,
} from './ink';
import { MAX_COORDINATE } from './model';
import { readContainers, readStrokes } from './read';
import { readingOrder } from './reading-order';
import { plainText, readRichText } from './rich-text';
import { NOTEBOOK_ORIGIN, containerFragment, entityMap, notebookTypes } from './schema';
import type { NotebookEditContext } from './structure';

const context = (doc = new Y.Doc(), client = 'a'): NotebookEditContext => ({
	types: notebookTypes(doc),
	newId: createIdGenerator(client, 'nb'),
	now: () => 1,
	origin: NOTEBOOK_ORIGIN,
});
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe('page canvas', () => {
	it('places text, pictures and files with geometry, stacking and bytes', () => {
		const ctx = context();
		const text = addText(ctx, 'p1', {
			x: 10.4,
			y: 20,
			content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }],
		});
		const image = addImage(ctx, 'p1', {
			x: 50,
			y: 60,
			width: 200,
			height: 100,
			name: 'cat.png',
			mime: 'image/png',
			bytes: png,
			alt: 'A cat',
		});
		const file = addFile(ctx, 'p1', {
			x: 0,
			y: 300,
			width: 400,
			height: 300,
			name: 'Budget.xlsx',
			mime: '',
			bytes: png,
		});
		addText(ctx, 'p2', { x: 0, y: 0 });
		const page = readContainers(ctx.types, 'p1');
		expect(page.map((c) => [c.kind, c.x, c.y, c.width, c.height, c.z])).toEqual([
			['text', 10, 20, 320, 0, 1],
			['image', 50, 60, 200, 100, 2],
			['file', 0, 300, 400, 300, 3],
		]);
		expect(page[1]).toMatchObject({ name: 'cat.png', alt: 'A cat', mime: 'image/png' });
		expect(page[2]).toMatchObject({ name: 'Budget.xlsx', office: 'xlsx', size: png.length });
		expect(containerBytes(ctx, image)).toEqual(png);
		expect(containerBytes(ctx, text)).toBeNull();
		const fragment = containerFragment(entityMap(ctx.types.containers, text)!)!;
		expect(plainText(readRichText(fragment))).toBe('Hi');
		bringToFront(ctx, text);
		expect(readContainers(ctx.types, 'p1').at(-1)?.id).toBe(text);
		moveContainers(ctx, [text, image], 5, -5);
		resizeContainer(ctx, text, { width: 10, height: 999 });
		resizeContainer(ctx, file, { width: 9999, height: 10 });
		const moved = readContainers(ctx.types, 'p1');
		expect(moved.find((c) => c.id === text)).toMatchObject({ x: 15, y: 15, width: 40, height: 0 });
		expect(moved.find((c) => c.id === image)).toMatchObject({ x: 55, y: 55 });
		expect(moved.find((c) => c.id === file)).toMatchObject({ width: 4000, height: 16 });
		deleteContainers(ctx, [file]);
		expect(readContainers(ctx.types, 'p1')).toHaveLength(2);
	});

	it('refuses empty, oversized and misplaced binaries', () => {
		const ctx = context();
		const base = { x: 0, y: 0, width: 10, height: 10, name: 'x.png', mime: 'image/png' };
		expect(addImage(ctx, 'p1', { ...base, bytes: new Uint8Array() })).toBe('');
		expect(addImage(ctx, 'p1', { ...base, bytes: new Uint8Array(32 * 1024 * 1024 + 1) })).toBe('');
		expect(addImage(ctx, 'bad id', { ...base, bytes: png })).toBe('');
		expect(addText(ctx, '', { x: 0, y: 0 })).toBe('');
	});

	it('keeps concurrent move and resize of one container', () => {
		const one = new Y.Doc();
		const a = context(one, 'a');
		const id = addText(a, 'p', { x: 0, y: 0 });
		const two = new Y.Doc();
		Y.applyUpdate(two, Y.encodeStateAsUpdate(one));
		const b = context(two, 'b');
		moveContainers(a, [id], 30, 40);
		resizeContainer(b, id, { width: 500 });
		Y.applyUpdate(one, Y.encodeStateAsUpdate(two));
		Y.applyUpdate(two, Y.encodeStateAsUpdate(one));
		for (const ctx of [a, b])
			expect(readContainers(ctx.types, 'p')[0]).toMatchObject({ x: 30, y: 40, width: 500 });
	});

	it('stores ink compactly and erases whole strokes', () => {
		const ctx = context();
		const points = [0, 0, 0.5, 0.2, 0.1, 0.5, 10, 10, 0.75, 20.04, 10, 1];
		const id = addStroke(ctx, 'p', { tool: 'pen', color: '#FF0000', width: 3, points });
		expect(addStroke(ctx, 'p', { tool: 'pen', color: '#000000', width: 3, points: [1, 2] })).toBe(
			'',
		);
		const [stroke] = readStrokes(ctx.types, 'p');
		expect(stroke).toMatchObject({ id, tool: 'pen', color: '#ff0000', width: 3 });
		// The second point was closer than 0.75px to the first and was dropped.
		expect(stroke?.points).toEqual([0, 0, 0.5, 10, 10, 0.75, 20, 10, 1]);
		deleteStrokes(ctx, [id]);
		expect(readStrokes(ctx.types, 'p')).toEqual([]);
	});
});

describe('ink geometry', () => {
	it('encodes points as integers and rejects malformed arrays', () => {
		expect(encodeInkPoints([1.234, 5.678, 0.333])).toEqual([12, 57, 33]);
		expect(decodeInkPoints([12, 57, 33])).toEqual([1.2, 5.7, 0.33]);
		expect(decodeInkPoints([1, 2, 'x'])).toEqual([]);
		expect(decodeInkPoints([1, 2, 3e9])).toEqual([0.1, 0.2, 1]);
		expect(decodeInkPoints('nope')).toEqual([]);
		expect(simplifyInk([0, 0, 0.5])).toEqual([0, 0, 0.5]);
	});

	it('outlines, bounds and hits strokes by pressure', () => {
		const line = [0, 0, 0.5, 100, 0, 0.5];
		expect(inkBounds([line], 4)).toEqual({ x: -2, y: -2, width: 104, height: 4 });
		expect(inkBounds([[0, 0, 1]], 4).width).toBeCloseTo(6.4);
		expect(inkBounds([[0, 0, 0]], 4, 'highlighter').width).toBe(4);
		const outline = inkOutline(line, 4);
		expect(outline.startsWith('M')).toBe(true);
		expect(outline.endsWith('Z')).toBe(true);
		expect(outline).toContain('A');
		expect(inkOutline([5, 5, 0.5], 4)).toMatch(/^M3 5a2 2 0 1 0 4 0/u);
		expect(inkOutline([], 4)).toBe('');
		const stroke = { points: line, width: 4, tool: 'pen' as const };
		expect(inkHits(stroke, 50, 3, 2)).toBe(true);
		expect(inkHits(stroke, 50, 6, 2)).toBe(false);
		expect(strokesBounds([stroke, { points: [0, 50, 0.5], width: 2, tool: 'pen' }])).toEqual({
			x: -2,
			y: -2,
			width: 104,
			height: 53,
		});
		expect(strokesBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
	});
});

describe('reading order', () => {
	it('reads top to bottom, then left to right within a row band', () => {
		const items = [
			{ id: 'b', x: 300, y: 104 },
			{ id: 'c', x: 0, y: 400 },
			{ id: 'a', x: 0, y: 100 },
			{ id: 'z', x: 50, y: 0 },
		];
		expect(readingOrder(items).map((i) => i.id)).toEqual(['z', 'a', 'b', 'c']);
		expect(readingOrder(items, 1).map((i) => i.id)).toEqual(['z', 'a', 'b', 'c']);
		expect(
			readingOrder([
				{ id: 'r', x: 300, y: 100 },
				{ id: 'l', x: 0, y: 110 },
			]).map((i) => i.id),
		).toEqual(['l', 'r']);
	});

	it('draws a long vertical or horizontal stroke as a stroke, not a dot', () => {
		const vertical = [10, 0, 0.5, 10, 100, 0.5];
		const horizontal = [0, 10, 0.5, 100, 10, 0.5];
		for (const stroke of [vertical, horizontal]) {
			expect(inkOutline(stroke, 4)).not.toMatch(/a2 2 0 1 0/u);
			expect(inkOutline(stroke, 4)).toContain('L');
		}
		// A tap that reports the same point twice is still a dot.
		expect(inkOutline([10, 0, 0.5, 10, 0, 0.5], 4)).toMatch(/a2 2 0 1 0/u);
	});
});

describe('ink storage', () => {
	it('splits a long stroke, clamps far points and keeps the drawing order across sessions', () => {
		const doc = new Y.Doc();
		const types = notebookTypes(doc);
		const ctx = (prefix: string, start: number) => {
			let n = start;
			const edit: NotebookEditContext = {
				types,
				newId: () => `${prefix}-${n++}`,
				now: () => 0,
				origin: NOTEBOOK_ORIGIN,
			};
			return edit;
		};
		const first = ctx('ink-a', 9);
		const points: number[] = [];
		for (let i = 0; i < MAX_INK_POINTS + 1000; i++) points.push(i % 2 ? i : -i, i, 0.5);
		const page = 'p1';
		addStroke(first, page, { tool: 'pen', color: '#000000', width: 2, points });
		expect(readStrokes(types, page)).toHaveLength(2);
		addStroke(first, page, {
			tool: 'pen',
			color: '#000000',
			width: 2,
			points: [0, 0, 0.5, 1e9, 10, 0.5],
		});
		// A later session's counter starts low again; its stroke still comes last.
		const later = addStroke(ctx('ink-b', 1), page, {
			tool: 'pen',
			color: '#ff0000',
			width: 2,
			points: [5, 5, 0.5, 9, 9, 0.5],
		});
		const strokes = readStrokes(types, page);
		expect(strokes).toHaveLength(4);
		expect(strokes.at(-1)!.id).toBe(later);
		expect(strokes[2]!.points[3]).toBe(MAX_COORDINATE);
	});

	it('stores a split stroke as one connected line, with no stray single point', () => {
		const types = notebookTypes(new Y.Doc());
		let n = 0;
		const edit: NotebookEditContext = {
			types,
			newId: () => `ink-${n++}`,
			now: () => 0,
			origin: NOTEBOOK_ORIGIN,
		};
		const points: number[] = [];
		for (let i = 0; i < MAX_INK_POINTS + 1; i++) points.push(i % 2 ? i : -i, i, 0.5);
		addStroke(edit, 'p1', { tool: 'pen', color: '#000000', width: 2, points });
		const [head, tail] = readStrokes(types, 'p1');
		expect(head!.points).toHaveLength(MAX_INK_POINTS * 3);
		// The second part starts where the first ends and carries the one point left over.
		expect(tail!.points.slice(0, 3)).toEqual(head!.points.slice(-3));
		expect(tail!.points.slice(3)).toEqual(points.slice(-3));
		// Exactly full: one stroke, not a second one holding only the shared point.
		addStroke(edit, 'p2', { tool: 'pen', color: '#000000', width: 2, points: points.slice(0, -3) });
		expect(readStrokes(types, 'p2')).toHaveLength(1);
	});
});
