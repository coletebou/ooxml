// The dates and times the calendar view writes, through `Intl` in the display locale and the view's
// zone: the shown range, the hour scale, clock times and day names. The formatters are kept for
// reuse, since a month grid formats dozens of dates per render. Moved from
// `teams/calendar-view.ts` (the range, hour and clock text); the cache and the month range are new.
import type { CalendarDay, CalendarMode } from 'ooxml-core/calendar';
import type { CalendarGridItem, GridContext, ShownOccurrence } from './types';

const formats = new Map<string, Intl.DateTimeFormat>();

/** A cached `Intl.DateTimeFormat` for a locale (undefined: the browser's) and options. */
export function dateFormat(
	intl: string | undefined,
	options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
	const key = `${intl ?? ''} ${JSON.stringify(options)}`;
	let format = formats.get(key);
	if (!format) {
		format = new Intl.DateTimeFormat(intl, options);
		formats.set(key, format);
	}
	return format;
}

/**
 * What the view shows as its heading: the whole date of one day ("Thursday, October 15, 2026"), the
 * first and last day of a week ("October 12 - 16, 2026") or the month ("October 2026").
 */
export function rangeText(
	days: readonly CalendarDay[],
	mode: CalendarMode,
	anchor: number,
	zone: string,
	intl: string | undefined,
): string {
	const first = days[0]!;
	const last = days[days.length - 1]!;
	if (mode === 'month')
		return dateFormat(intl, { month: 'long', year: 'numeric', timeZone: zone }).format(anchor);
	if (days.length === 1)
		return dateFormat(intl, {
			weekday: 'long',
			month: 'long',
			day: 'numeric',
			year: 'numeric',
			timeZone: zone,
		}).format(first.start);
	return dateFormat(intl, {
		month: 'long',
		day: 'numeric',
		year: 'numeric',
		timeZone: zone,
	}).formatRange(first.start, last.start);
}

/** An hour of the time grid's scale ("9 AM"); none at midnight. */
export function hourLabel(hour: number, intl: string | undefined): string {
	if (hour === 0) return '';
	return dateFormat(intl, { hour: 'numeric', timeZone: 'UTC' }).format(Date.UTC(2000, 0, 1, hour));
}

/** A clock time in the zone ("9:30 AM"). */
export function clockText(ms: number, zone: string, intl: string | undefined): string {
	return dateFormat(intl, { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(ms);
}

/** The name of a day ("Thursday, October 15"), what a day's column or cell is called. */
export function dayName(
	day: Pick<CalendarDay, 'start'>,
	zone: string,
	intl: string | undefined,
): string {
	return dateFormat(intl, {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		timeZone: zone,
	}).format(day.start);
}

/** The short name of a day's weekday ("Thu"). */
export function weekdayName(ms: number, zone: string, intl: string | undefined): string {
	return dateFormat(intl, { weekday: 'short', timeZone: zone }).format(ms);
}

/** An occurrence's own title, else its event's, else the product's word for no title. */
export function eventTitle<E extends CalendarGridItem>(
	view: GridContext<E>,
	occurrence: ShownOccurrence<E>,
): string {
	return (occurrence.title ?? occurrence.item.title) || view.label('untitled');
}

/** "9:00 AM - 10:00 AM": the times of a timed occurrence. */
export function timeRange<E extends CalendarGridItem>(
	view: GridContext<E>,
	occurrence: Pick<ShownOccurrence<E>, 'start' | 'end'>,
): string {
	return `${clockText(occurrence.start, view.zone, view.intl)} - ${clockText(occurrence.end, view.zone, view.intl)}`;
}
