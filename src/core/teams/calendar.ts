// The week view rules for meetings: which occurrences of a meeting fall in a range, the days a work
// week / week / day view shows in the viewer's zone, how overlapping meetings share a day column
// and which reminders are due. The rules themselves are the calendar area's (`ooxml-core/calendar`);
// this module keeps Teams' names and types (an occurrence names its `meetingId`). No clock and no
// storage: callers pass `now`. DOM-free. New code.
import {
	type Occurrence as EventOccurrence,
	REMINDER_LEAD_MS,
	dueOccurrences,
	occurrenceAt as eventOccurrenceAt,
	occurrencesBetween as eventOccurrences,
} from '../calendar/occurrences';
import { layoutDay as layoutOccurrences } from '../calendar/layout';
import {
	type CalendarDay,
	shiftAnchor as shiftCalendarAnchor,
	viewDays as calendarViewDays,
} from '../calendar/views';
import type { Meeting } from './meetings';

export { REMINDER_LEAD_MS };
export type { CalendarDay } from '../calendar/views';

export interface Occurrence {
	/** `<meeting id>@<start>`: stable per occurrence, what reminders remember. */
	key: string;
	meetingId: string;
	start: number;
	end: number;
	/** 0 for the first occurrence. */
	index: number;
	/** The start this occurrence had in the series (iCalendar RECURRENCE-ID), when it repeats. */
	recurrenceId?: number;
	/** This occurrence was changed on its own; the overrides below are set for what changed. */
	changed?: boolean;
	title?: string;
	description?: string;
}

const ofMeeting = (o: EventOccurrence): Occurrence => ({
	key: o.key,
	meetingId: o.eventId,
	start: o.start,
	end: o.end,
	index: o.index,
	...(o.recurrenceId !== undefined ? { recurrenceId: o.recurrenceId } : {}),
	...(o.changed ? { changed: true } : {}),
	...(o.title !== undefined ? { title: o.title } : {}),
	...(o.description !== undefined ? { description: o.description } : {}),
});

/**
 * Occurrences that overlap `[from, to)`, in start order. Cancelled meetings have none; a repeat
 * stops at its end (count or date), skips cancelled occurrences and applies changed ones.
 */
export function occurrencesBetween(meeting: Meeting, from: number, to: number): Occurrence[] {
	return eventOccurrences(meeting, from, to).map(ofMeeting);
}

/** The occurrence that starts exactly at `start` (as shown), or null. */
export const occurrenceAt = (meeting: Meeting, start: number): Occurrence | null => {
	const occurrence = eventOccurrenceAt(meeting, start);
	return occurrence ? ofMeeting(occurrence) : null;
};

export type CalendarMode = 'workweek' | 'week' | 'day';

/** The days a view shows around `anchor`: Monday to Friday, Monday to Sunday, or just that day. */
export function viewDays(anchor: number, mode: CalendarMode, zone: string): CalendarDay[] {
	return calendarViewDays(anchor, mode, zone);
}

/** Previous (-1) or next (1) period: a day for the day view, a week otherwise. */
export function shiftAnchor(
	anchor: number,
	mode: CalendarMode,
	direction: -1 | 1,
	zone: string,
): number {
	return shiftCalendarAnchor(anchor, mode, direction, zone);
}

export interface PlacedOccurrence {
	occurrence: Occurrence;
	/** Minutes after local midnight, clipped to the day. */
	startMinute: number;
	endMinute: number;
	/** The side-by-side column and how many columns the overlapping group has. */
	column: number;
	columns: number;
}

/** Position occurrences in one day's column; overlapping ones share the width. */
export function layoutDay(
	occurrences: readonly Occurrence[],
	day: Pick<CalendarDay, 'start' | 'end'>,
	zone: string,
): PlacedOccurrence[] {
	return layoutOccurrences(occurrences, day, zone);
}

/** Occurrences that start within `lead` of `now` (and have not started). */
export function remindersDue(
	meetings: readonly Meeting[],
	now: number,
	lead: number = REMINDER_LEAD_MS,
): { meeting: Meeting; occurrence: Occurrence }[] {
	return dueOccurrences(meetings, now, lead).map(({ event, occurrence }) => ({
		meeting: event,
		occurrence: ofMeeting(occurrence),
	}));
}
