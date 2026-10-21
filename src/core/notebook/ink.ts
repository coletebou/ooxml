// Ink geometry: the stored point encoding, simplification while drawing, variable-width outlines
// (SVG path data the UI fills and the export rasterises), bounds and eraser hit testing. Pressure
// widens a pen stroke (a mouse reports 0.5, which draws the nominal width); a highlighter is a flat
// band. Pure maths, no DOM. New code.
import { MAX_COORDINATE } from './model';

/** Stored points are integers: tenths of a pixel for x and y, hundredths for pressure. */
const XY = 10;
const P = 100;
export const MAX_INK_POINTS = 6000;

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Flat `[x, y, pressure, ...]` (CSS px, 0-1) to the stored integer array. */
export function encodeInkPoints(points: readonly number[]): number[] {
	const out: number[] = [];
	const n = Math.min(Math.floor(points.length / 3), MAX_INK_POINTS);
	for (let i = 0; i < n; i++) {
		const x = points[i * 3] ?? 0;
		const y = points[i * 3 + 1] ?? 0;
		const p = points[i * 3 + 2] ?? 0.5;
		out.push(Math.round(x * XY), Math.round(y * XY), Math.round(Math.min(1, Math.max(0, p)) * P));
	}
	return out;
}

/** The stored array back to flat CSS-px triples; anything malformed is dropped. */
export function decodeInkPoints(value: unknown): number[] {
	if (!Array.isArray(value)) return [];
	const out: number[] = [];
	const limit = MAX_COORDINATE * XY;
	for (let i = 0; i + 2 < value.length && out.length < MAX_INK_POINTS * 3; i += 3) {
		const x = value[i];
		const y = value[i + 1];
		const p = value[i + 2];
		if (typeof x !== 'number' || typeof y !== 'number' || typeof p !== 'number') return [];
		if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > limit || Math.abs(y) > limit)
			return [];
		out.push(x / XY, y / XY, Math.min(1, Math.max(0, p / P)));
	}
	return out;
}

/** Drop points closer than `minDistance` to the last kept one (the last point always stays). */
export function simplifyInk(points: readonly number[], minDistance = 0.75): number[] {
	const n = Math.floor(points.length / 3);
	if (n <= 2) return points.slice(0, n * 3);
	const out = points.slice(0, 3);
	for (let i = 1; i < n; i++) {
		const x = points[i * 3] ?? 0;
		const y = points[i * 3 + 1] ?? 0;
		const lastX = out[out.length - 3] ?? 0;
		const lastY = out[out.length - 2] ?? 0;
		if (i < n - 1 && Math.hypot(x - lastX, y - lastY) < minDistance) continue;
		out.push(x, y, points[i * 3 + 2] ?? 0.5);
	}
	return out;
}

/** Width at a point: pressure 0.5 is the nominal width, 0 is 40% and 1 is 160%. */
export function inkWidthAt(width: number, pressure: number, tool: 'pen' | 'highlighter'): number {
	return tool === 'highlighter' ? width : width * (0.4 + 1.2 * pressure);
}

const fmt = (n: number): string => (Math.round(n * 100) / 100).toString();

/**
 * A closed outline of the stroke (SVG path data, filled with nonzero): left edge forward, a round
 * cap, the right edge back, a round cap. A single point is a dot.
 */
export function inkOutline(
	points: readonly number[],
	width: number,
	tool: 'pen' | 'highlighter' = 'pen',
): string {
	const n = Math.floor(points.length / 3);
	if (n === 0) return '';
	const px = (i: number): number => points[i * 3] ?? 0;
	const py = (i: number): number => points[i * 3 + 1] ?? 0;
	const half = (i: number): number => inkWidthAt(width, points[i * 3 + 2] ?? 0.5, tool) / 2;
	if (n === 1 || inkBounds([points], width, tool).width <= half(0) * 2.01) {
		const r = Math.max(half(0), 0.5);
		const x = px(0);
		const y = py(0);
		return `M${fmt(x - r)} ${fmt(y)}a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(r * 2)} 0a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-r * 2)} 0Z`;
	}
	const left: string[] = [];
	const right: string[] = [];
	for (let i = 0; i < n; i++) {
		const a = Math.max(0, i - 1);
		const b = Math.min(n - 1, i + 1);
		let dx = px(b) - px(a);
		let dy = py(b) - py(a);
		const len = Math.hypot(dx, dy) || 1;
		dx /= len;
		dy /= len;
		const h = half(i);
		left.push(`${fmt(px(i) - dy * h)} ${fmt(py(i) + dx * h)}`);
		right.push(`${fmt(px(i) + dy * h)} ${fmt(py(i) - dx * h)}`);
	}
	const end = half(n - 1);
	const start = half(0);
	return (
		`M${left[0]}L${left.slice(1).join('L')}` +
		`A${fmt(end)} ${fmt(end)} 0 0 0 ${right[n - 1]}` +
		`L${right
			.slice(0, n - 1)
			.reverse()
			.join('L')}` +
		`A${fmt(start)} ${fmt(start)} 0 0 0 ${left[0]}Z`
	);
}

/** Bounds of strokes (each a flat point array) including their widths. */
export function inkBounds(
	strokes: readonly (readonly number[])[],
	width: number,
	tool: 'pen' | 'highlighter' = 'pen',
): Rect {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const points of strokes) {
		for (let i = 0; i + 2 < points.length; i += 3) {
			const h = inkWidthAt(width, points[i + 2] ?? 0.5, tool) / 2;
			const x = points[i] ?? 0;
			const y = points[i + 1] ?? 0;
			minX = Math.min(minX, x - h);
			minY = Math.min(minY, y - h);
			maxX = Math.max(maxX, x + h);
			maxY = Math.max(maxY, y + h);
		}
	}
	if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Bounds of whole strokes with their own widths and tools. */
export function strokesBounds(
	strokes: readonly { points: readonly number[]; width: number; tool: 'pen' | 'highlighter' }[],
): Rect {
	const boxes = strokes.map((s) => inkBounds([s.points], s.width, s.tool)).filter((b) => b.width);
	if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
	const x = Math.min(...boxes.map((b) => b.x));
	const y = Math.min(...boxes.map((b) => b.y));
	const right = Math.max(...boxes.map((b) => b.x + b.width));
	const bottom = Math.max(...boxes.map((b) => b.y + b.height));
	return { x, y, width: right - x, height: bottom - y };
}

function segmentDistance(
	x: number,
	y: number,
	ax: number,
	ay: number,
	bx: number,
	by: number,
): number {
	const dx = bx - ax;
	const dy = by - ay;
	const len2 = dx * dx + dy * dy;
	const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
	return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

/** True when an eraser of `radius` at (x, y) touches the stroke. */
export function inkHits(
	stroke: { points: readonly number[]; width: number; tool: 'pen' | 'highlighter' },
	x: number,
	y: number,
	radius: number,
): boolean {
	const { points } = stroke;
	const n = Math.floor(points.length / 3);
	for (let i = 0; i < n; i++) {
		const j = Math.min(n - 1, i + 1);
		const reach = radius + inkWidthAt(stroke.width, points[i * 3 + 2] ?? 0.5, stroke.tool) / 2;
		const d = segmentDistance(
			x,
			y,
			points[i * 3] ?? 0,
			points[i * 3 + 1] ?? 0,
			points[j * 3] ?? 0,
			points[j * 3 + 1] ?? 0,
		);
		if (d <= reach) return true;
	}
	return false;
}

/** The points moved by (dx, dy). */
export function translateInk(points: readonly number[], dx: number, dy: number): number[] {
	return points.map((v, i) => (i % 3 === 0 ? v + dx : i % 3 === 1 ? v + dy : v));
}
