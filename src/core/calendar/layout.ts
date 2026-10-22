// How the timed occurrences of one day share its column: each is placed by its minutes after
// local midnight (clipped to the day), and overlapping ones sit side by side, a later one taking
// the first column that is free again. An occurrence without length is on the day it starts, as
// the views list it. All-day occurrences belong in a row of their own above the grid. DOM-free.
// Moved from src/core/teams/calendar.ts (`layoutDay`, now generic over the occurrence type).
import { type Occurrence, overlapsRange } from './occurrences';
import type { CalendarDay } from './views';
import { minuteOfDay } from './time-zone';

export interface PlacedOccurrence<O extends Pick<Occurrence, 'start' | 'end'> = Occurrence> {
	occurrence: O;
	/** Minutes after local midnight, clipped to the day. */
	startMinute: number;
	endMinute: number;
	/** The side-by-side column and how many columns the overlapping group has. */
	column: number;
	columns: number;
}

/** Position occurrences in one day's column; overlapping ones share the width. */
export function layoutDay<O extends Pick<Occurrence, 'start' | 'end'>>(
	occurrences: readonly O[],
	day: Pick<CalendarDay, 'start' | 'end'>,
	zone: string,
): PlacedOccurrence<O>[] {
	const items = occurrences
		.filter((o) => overlapsRange(o, day.start, day.end))
		.map((occurrence) => ({
			occurrence,
			startMinute: occurrence.start <= day.start ? 0 : minuteOfDay(occurrence.start, zone),
			endMinute:
				occurrence.end >= day.end ? 24 * 60 : Math.max(minuteOfDay(occurrence.end, zone), 1),
			column: 0,
			columns: 1,
		}))
		.sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);
	let group: typeof items = [];
	let groupEnd = -1;
	const close = (): void => {
		const columns = group.reduce((m, i) => Math.max(m, i.column + 1), 1);
		for (const i of group) i.columns = columns;
		group = [];
	};
	for (const item of items) {
		if (group.length && item.startMinute >= groupEnd) close();
		const taken = new Set(group.filter((g) => g.endMinute > item.startMinute).map((g) => g.column));
		while (taken.has(item.column)) item.column++;
		group.push(item);
		groupEnd = Math.max(groupEnd, item.endMinute);
	}
	close();
	return items;
}
