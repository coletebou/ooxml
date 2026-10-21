// An event as an edit form holds it, and back. Start and end are wall-clock date and time input
// values in the calendar's zone (all-day dates in the event's own zone); an all-day event's end date
// is its last day, stored as the start of the day after it (the model's exclusive end). Moving the
// start keeps the length. `buildEvent` turns a draft into the `CalendarEvent` to store or names what
// keeps it from being saved. A repeating event is edited as a whole series. DOM-free. New code.
import {
	dayMatchesOrdinal,
	MINUTE_MS,
	zonedParts,
	zonedToUtc,
	type CalendarEvent,
	type Repeat,
} from 'ooxml-core/calendar';
import { dateValue, daysBetween, fromInputs, shiftDate, timeValue } from './zoned-input';

/** The fields of an event form as they are being edited. */
export interface EventDraft {
	/** The stored event being edited; null for a new one. */
	original: CalendarEvent | null;
	title: string;
	allDay: boolean;
	/** `YYYY-MM-DD` and `HH:MM`; for an all-day event `endDate` is its last day. */
	startDate: string;
	startTime: string;
	endDate: string;
	endTime: string;
	location: string;
	description: string;
	repeat: Repeat;
}

/** What keeps a draft from being saved: no title, no valid times, or an end before the start. */
export type DraftIssue = 'title' | 'when' | 'order';

const NEW_LENGTH = 30 * MINUTE_MS;

/** The instant of a timed draft's date and time; an empty time is no time at all. */
const instant = (date: string, time: string, zone: string): number | null =>
	time ? fromInputs(date, time, zone) : null;

/** 9:00 on the day of `ms` in the zone, where a timed event starts when all day is unticked. */
const nineOn = (ms: number, zone: string): number => {
	const p = zonedParts(ms, zone);
	return zonedToUtc({ year: p.year, month: p.month, day: p.day, hour: 9 }, zone);
};

/**
 * A draft of a new event at `start` (a whole day when `allDay`), in the calendar's zone. A timed
 * one ends half an hour later, on the next day when that runs past midnight.
 */
export function newDraft(start: number, allDay: boolean, zone: string): EventDraft {
	const begin = allDay ? nineOn(start, zone) : start;
	return {
		original: null,
		title: '',
		allDay,
		startDate: dateValue(start, zone),
		startTime: timeValue(begin, zone),
		endDate: dateValue(allDay ? start : begin + NEW_LENGTH, zone),
		endTime: timeValue(begin + NEW_LENGTH, zone),
		location: '',
		description: '',
		repeat: 'none',
	};
}

/** A draft of a stored event; timed ones in the calendar's zone, all-day ones on their own dates. */
export function draftOf(event: CalendarEvent, zone: string): EventDraft {
	const allDay = event.allDay === true;
	const at = allDay ? event.zone : zone;
	const begin = allDay ? nineOn(event.start, event.zone) : event.start;
	return {
		original: event,
		title: event.title,
		allDay,
		startDate: dateValue(event.start, at),
		startTime: timeValue(begin, at),
		// The last day of an all-day event is the day before its exclusive end.
		endDate: dateValue(allDay ? Math.max(event.start, event.end - 1) : event.end, at),
		endTime: timeValue(allDay ? begin + NEW_LENGTH : event.end, at),
		location: event.location ?? '',
		description: event.description,
		repeat: event.repeat,
	};
}

/** `next` with its end moved as far as its start moved from `previous`, so the length stays. */
export function keepLength(next: EventDraft, previous: EventDraft, zone: string): EventDraft {
	if (next.allDay) {
		const days = daysBetween(previous.startDate, previous.endDate);
		const end = days === null ? '' : shiftDate(next.startDate, Math.max(0, days));
		return end ? { ...next, endDate: end } : next;
	}
	const before = instant(previous.startDate, previous.startTime, zone);
	const after = instant(next.startDate, next.startTime, zone);
	const end = instant(previous.endDate, previous.endTime, zone);
	if (before === null || after === null || end === null || before === after) return next;
	const moved = end + (after - before);
	return { ...next, endDate: dateValue(moved, zone), endTime: timeValue(moved, zone) };
}

const SET_HERE = ['allDay', 'location', 'monthlyBy', 'ordinal', 'until', 'count', 'exceptions'];

/** `event` without the optional fields a draft sets itself or may have to drop. */
function kept(event: CalendarEvent): Partial<CalendarEvent> {
	const out: Partial<CalendarEvent> = { ...event };
	for (const key of SET_HERE) delete out[key as keyof CalendarEvent];
	return out;
}

/**
 * The repeat fields to keep from the stored event: its end (count or date) while it still repeats,
 * the monthly rule while it stays monthly (the weekday ordinal while the start's date in the
 * event's zone still fits it: a new time keeps "the last Friday"), and the changed or cancelled
 * occurrences only while the series keeps its start, repeat and kind.
 */
function series(
	original: CalendarEvent,
	repeat: Repeat,
	start: number,
	allDay: boolean,
	zone: string,
) {
	if (repeat === 'none' || original.repeat === 'none') return {};
	const same = original.repeat === repeat;
	const moved = start !== original.start || !same || allDay !== (original.allDay === true);
	const day = zonedParts(start, zone);
	const ordinal = original.ordinal;
	const keepOrdinal =
		ordinal !== undefined &&
		same &&
		(!moved || dayMatchesOrdinal(day.year, day.month, day.day, ordinal));
	return {
		...(original.until !== undefined ? { until: original.until } : {}),
		...(original.count !== undefined ? { count: original.count } : {}),
		...(same && repeat === 'monthly' && original.monthlyBy
			? { monthlyBy: original.monthlyBy }
			: {}),
		...(keepOrdinal ? { ordinal } : {}),
		...(!moved && original.exceptions?.length ? { exceptions: original.exceptions } : {}),
	};
}

/** Whether the date and time fields of `draft` still show what they showed for the stored event. */
const shows = (
	draft: EventDraft,
	shown: EventDraft,
	date: 'startDate' | 'endDate',
	time: 'startTime' | 'endTime',
): boolean =>
	draft.allDay === shown.allDay &&
	draft[date] === shown[date] &&
	(draft.allDay || draft[time] === shown[time]);

/** The event a draft describes (`newId` names a new one), or the first issue keeping it unsaved. */
export function buildEvent(
	draft: EventDraft,
	zone: string,
	newId: () => string,
): { event: CalendarEvent } | { issue: DraftIssue } {
	const title = draft.title.trim();
	if (!title) return { issue: 'title' };
	const original = draft.original;
	const eventZone = original?.zone ?? zone;
	const named = draft.allDay
		? fromInputs(draft.startDate, '', eventZone)
		: instant(draft.startDate, draft.startTime, zone);
	const namedEnd = draft.allDay
		? fromInputs(shiftDate(draft.endDate, 1), '', eventZone)
		: instant(draft.endDate, draft.endTime, zone);
	if (named === null || namedEnd === null) return { issue: 'when' };
	if (draft.allDay ? namedEnd <= named : namedEnd < named) return { issue: 'order' };
	// The time fields show whole minutes. A start or an end they still show as they did for the
	// stored event keeps its own instant, seconds and all, so a new title alone neither moves an
	// event that starts at 09:00:30 nor drops the changed occurrences of its series. A new end in the
	// minute the start shows is never before the start.
	const shown = original ? draftOf(original, zone) : null;
	const start =
		original && shown && shows(draft, shown, 'startDate', 'startTime') ? original.start : named;
	const end =
		original && shown && shows(draft, shown, 'endDate', 'endTime')
			? original.end
			: Math.max(namedEnd, start);
	const location = draft.location.trim();
	return {
		event: {
			...(original ? kept(original) : {}),
			id: original?.id ?? newId(),
			title,
			description: draft.description,
			start,
			end,
			zone: eventZone,
			repeat: draft.repeat,
			...(draft.allDay ? { allDay: true } : {}),
			...(location ? { location } : {}),
			...(original ? series(original, draft.repeat, start, draft.allDay, eventZone) : {}),
		},
	};
}
