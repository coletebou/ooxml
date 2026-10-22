// The VTIMEZONE blocks of an export: one per zone a timed event uses, for every year the file
// needs it in. The block a repeating event refers to must hold for all its occurrences (RFC 5545
// 3.6.5), so a series is covered through its last occurrence, and one that does not end through
// ten years after the export, after which the zone's yearly rules carry on. Zone data has nothing
// to add long before or after now (offsets before standard time stay as they were, and the future
// repeats the last rules), so the years read are kept within two hundred before the export and a
// hundred after it: a slip in a year (1026 for 2026) never makes a file slow to write. Split from
// `ics-write.ts`. DOM-free. New code.
import { vtimezoneLines } from './ics-timezone';
import type { CalendarEvent } from './model';
import { seriesStart } from './recurrence';
import { zonedParts } from './time-zone';

/** A series that does not end is covered this many years after the export (or its start). */
const OPEN_YEARS = 10;
const YEARS_BEFORE = 200;
const YEARS_AFTER = 100;

/** The first and the last year an event's times and occurrences fall in, or null for none. */
function eventYears(event: CalendarEvent, nowYear: number): [number, number] | null {
	const year = (ms: number): number => zonedParts(ms, event.zone).year;
	const changed = event.repeat === 'none' ? [] : (event.exceptions ?? []);
	const years = [
		event.start,
		event.end,
		...changed.flatMap((e) => [
			e.originalStart,
			e.start ?? e.originalStart,
			e.end ?? e.originalStart,
		]),
	]
		.filter(Number.isFinite)
		.map(year);
	if (!years.length) return null;
	let last = Math.max(...years);
	if (event.repeat !== 'none') {
		const final = event.count !== undefined ? seriesStart(event, event.count - 1) : event.until;
		const end = (final ?? Number.NaN) + (event.end - event.start);
		last = Math.max(
			last,
			Number.isFinite(end) ? year(end) : Math.max(year(event.start), nowYear) + OPEN_YEARS,
		);
	}
	return [Math.min(...years), last];
}

/** One VTIMEZONE per zone of `events` (timed ones in a zone other than UTC), by zone name. */
export function timezoneBlocks(events: readonly CalendarEvent[], now: number): string[] {
	const exported = new Date(now).getUTCFullYear();
	const nowYear = Number.isNaN(exported) ? new Date().getUTCFullYear() : exported;
	const spans = new Map<string, [number, number]>();
	for (const event of events) {
		const years = eventYears(event, nowYear);
		if (!years) continue;
		const held = spans.get(event.zone);
		spans.set(
			event.zone,
			held ? [Math.min(held[0], years[0]), Math.max(held[1], years[1])] : years,
		);
	}
	const earliest = nowYear - YEARS_BEFORE;
	const latest = nowYear + YEARS_AFTER;
	return [...spans]
		.sort(([a], [b]) => a.localeCompare(b))
		.flatMap(([zone, [first, last]]) => {
			const from = Math.min(Math.max(first, earliest), latest);
			return vtimezoneLines(zone, from, Math.min(Math.max(last, from), latest));
		});
}
