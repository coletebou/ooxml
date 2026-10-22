// The days a calendar view shows in the viewer's zone (one day, a work week, a week or the six
// weeks of a month), stepping a view back and forth, and which occurrences fall on each day.
// DOM-free. `CalendarDay`, `viewDays` and `shiftAnchor` moved from src/core/teams/calendar.ts; the
// month view, the first day of the week and `eventsByDay` are new.
import { type DateRange, overlapsRange } from './occurrences';
import { daysInMonth } from './recurrence-calendar';
import { addDays, dayKey, zonedParts, zonedToUtc } from './time-zone';

export type CalendarMode = 'workweek' | 'week' | 'day' | 'month';

export interface CalendarDay {
	/** UTC instant of local midnight. */
	start: number;
	/** UTC instant of the next local midnight. */
	end: number;
	/** 0 = Sunday. */
	weekday: number;
	day: number;
	month: number;
	year: number;
}

/** A day of a month view: `inMonth` is false for the days of the months before and after. */
export interface MonthDay extends CalendarDay {
	inMonth: boolean;
}

/**
 * The day `offset` days from a wall date, from its own midnight to the next: a day that starts
 * late (a clock change at midnight) does not shift the days after it.
 */
function dayFrom(date: { year: number; month: number; day: number }, offset: number, zone: string) {
	const midnight = (n: number): number => zonedToUtc({ ...date, day: date.day + n }, zone);
	const start = midnight(offset);
	const p = zonedParts(start, zone);
	return {
		start,
		end: midnight(offset + 1),
		weekday: p.weekday,
		day: p.day,
		month: p.month,
		year: p.year,
	} satisfies CalendarDay;
}

/** A week day number (0 = Sunday) from any integer. */
const weekdayOf = (n: number): number => ((Math.trunc(n) % 7) + 7) % 7;

/**
 * The days a view shows around `anchor`: Monday to Friday, the seven days of the week (starting
 * on `weekStartsOn`, 0 = Sunday, Monday by default), just that day, or the 42 days of the month
 * view (see `monthGrid`). The work week is the Monday to Friday of the anchor's week.
 */
export function viewDays(
	anchor: number,
	mode: CalendarMode,
	zone: string,
	weekStartsOn = 1,
): CalendarDay[] {
	if (mode === 'month') return monthGrid(anchor, zone, weekStartsOn).flat();
	const { year, month, day, weekday } = zonedParts(anchor, zone);
	const date = { year, month, day };
	if (mode === 'day') return [dayFrom(date, 0, zone)];
	const first = weekdayOf(weekStartsOn);
	const sinceFirst = (weekday - first + 7) % 7;
	// The work week starts on the Monday of the week, whichever day the week starts on.
	const toMonday = mode === 'workweek' ? (8 - first) % 7 : 0;
	const count = mode === 'workweek' ? 5 : 7;
	return Array.from({ length: count }, (_, i) => dayFrom(date, toMonday - sinceFirst + i, zone));
}

/**
 * The same local time of day `months` later (or earlier) in the zone. The day of the month is
 * kept, or the month's last day when it is shorter: 31 January steps to 28 or 29 February.
 */
export function addMonths(ms: number, months: number, zone: string): number {
	const p = zonedParts(ms, zone);
	const total = p.year * 12 + (p.month - 1) + Math.trunc(months);
	const year = Math.floor(total / 12);
	const month = total - year * 12 + 1;
	return zonedToUtc({ ...p, year, month, day: Math.min(p.day, daysInMonth(year, month)) }, zone);
}

/** Previous (-1) or next (1) period: a day, a week (both week views) or a month. */
export function shiftAnchor(
	anchor: number,
	mode: CalendarMode,
	direction: -1 | 1,
	zone: string,
): number {
	if (mode === 'month') return addMonths(anchor, direction, zone);
	return addDays(anchor, direction * (mode === 'day' ? 1 : 7), zone);
}

/**
 * The month view of the anchor's month in the zone: always six weeks of seven days, so the grid
 * keeps its height from month to month, each week starting on `weekStartsOn` (0 = Sunday).
 */
export function monthGrid(anchor: number, zone: string, weekStartsOn = 1): MonthDay[][] {
	const { year, month } = zonedParts(anchor, zone);
	const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
	const lead = (first - weekdayOf(weekStartsOn) + 7) % 7;
	return Array.from({ length: 6 }, (_, week) =>
		Array.from({ length: 7 }, (_, i): MonthDay => {
			const day = dayFrom({ year, month, day: 1 }, week * 7 + i - lead, zone);
			return { ...day, inMonth: day.month === month && day.year === year };
		}),
	);
}

/** What `eventsByDay` reads of an occurrence. */
export interface DayItem {
	key: string;
	start: number;
	end: number;
	/** Set on all-day occurrences: they are placed by date, not by instant. */
	dates?: DateRange;
}

const dateNumber = (date: string): number => Number(date.replace(/-/gu, ''));

/**
 * The occurrences that touch each day, keyed by the day's `start`, every day present. A timed
 * occurrence is on each day its span overlaps (one without length on the day of its start); an
 * all-day one is on each of its dates, in any viewer zone. Each day lists its all-day occurrences
 * first, then the rest by start (longer first on a tie).
 */
export function eventsByDay<O extends DayItem>(
	occurrences: readonly O[],
	days: readonly Pick<CalendarDay, 'start' | 'end'>[],
	zone: string,
): Map<number, O[]> {
	const out = new Map<number, O[]>();
	for (const day of days) {
		const date = dateNumber(dayKey(day.start, zone));
		const list = occurrences.filter((o) =>
			o.dates
				? dateNumber(o.dates.start) <= date && date < dateNumber(o.dates.end)
				: overlapsRange(o, day.start, day.end),
		);
		list.sort(
			(a, b) =>
				Number(!a.dates) - Number(!b.dates) ||
				a.start - b.start ||
				b.end - a.end ||
				a.key.localeCompare(b.key),
		);
		out.set(day.start, list);
	}
	return out;
}
