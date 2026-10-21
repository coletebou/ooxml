// The order a free-form page is read in when it becomes flowing text (export, screen readers):
// top to bottom, then left to right. Items whose tops are within `band` pixels of the first item of
// a row count as one row and are read left to right, so two containers placed side by side by hand
// keep their left-to-right order even when one sits a few pixels lower. New code.

export interface Placed {
	x: number;
	y: number;
}

export function readingOrder<T extends Placed>(items: readonly T[], band = 16): T[] {
	const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
	const out: T[] = [];
	let row: T[] = [];
	let rowTop = 0;
	for (const item of sorted) {
		if (row.length && item.y - rowTop >= band) {
			out.push(...row.sort((a, b) => a.x - b.x));
			row = [];
		}
		if (!row.length) rowTop = item.y;
		row.push(item);
	}
	out.push(...row.sort((a, b) => a.x - b.x));
	return out;
}
