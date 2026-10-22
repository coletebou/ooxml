// The occurrences of an event in a range: a repeat stops at its end (count or date), skips
// cancelled occurrences and applies changed ones (daily and weekly repeats keep the event's
// wall-clock time, see `recurrence.ts`), and the reminders that are due. An all-day occurrence
// lasts whole days in the event's zone, so one across a clock change is 23 or 25 hours long, and
// carries the dates it covers; so does the part of a timed length that counts days on the clock
// (`nominalDays`). No clock and no storage: callers pass `now`. DOM-free. Moved from
// src/core/teams/calendar.ts (`occurrencesBetween`, `occurrenceAt`, `remindersDue`); the all-day,
// nominal and zero-length handling is new.
import type { CalendarEvent, EventException } from './model';
import { seriesBetween, seriesIndexOf } from './recurrence';
import { DAY_MS, MINUTE_MS, addDays, dayKey, zonedParts } from './time-zone';

/** A run of whole days as `YYYY-MM-DD` dates, `end` exclusive (iCalendar `VALUE=DATE`). */
export interface DateRange {
	start: string;
	end: string;
}

export interface Occurrence {
	/** `<event id>@<start>`: stable per occurrence, what reminders remember. */
	key: string;
	eventId: string;
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
	/** All-day occurrences: the dates they cover in the event's zone. */
	dates?: DateRange;
}

const MAX_OCCURRENCES = 400;

/** Whole days between the wall dates of two instants in a zone. */
function wallDays(from: number, to: number, zone: string): number {
	const a = zonedParts(from, zone);
	const b = zonedParts(to, zone);
	return Math.round(
		(Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY_MS,
	);
}

type Length = Pick<CalendarEvent, 'start' | 'end' | 'zone' | 'allDay' | 'nominalDays'>;

/**
 * The days on the clock a timed event's length counts (`nominalDays`) and the exact rest after
 * them, or null when its length is exact: it counts none, or it ends before they are over (an end
 * moved since), which makes it a length like any other.
 */
export function nominalLength(event: Length): { days: number; rest: number } | null {
	const days = event.nominalDays;
	if (event.allDay || days === undefined || !Number.isInteger(days) || days <= 0) return null;
	const rest = event.end - addDays(event.start, days, event.zone);
	return rest >= 0 ? { days, rest } : null;
}

/**
 * Where an unchanged occurrence ends, from its start: as long as the first one, for an all-day
 * event as many whole days in its zone, and for a length in days on the clock that many days
 * after its start and the same rest.
 */
function endsOf(event: Length): (start: number) => number {
	if (event.allDay) {
		const days = wallDays(event.start, event.end, event.zone);
		return (start) => addDays(start, days, event.zone);
	}
	const length = nominalLength(event);
	if (length) return (start) => addDays(start, length.days, event.zone) + length.rest;
	return (start) => start + (event.end - event.start);
}

/** Where an unchanged occurrence that starts at `start` ends (see `endsOf`). */
export const occurrenceEnd = (event: Length, start: number): number => endsOf(event)(start);

/**
 * Whether an occurrence overlaps `[from, to)`; one without length counts at its start, so it is in
 * the range (a day, say) that it starts in, its first instant included.
 */
export const overlapsRange = (
	o: Pick<Occurrence, 'start' | 'end'>,
	from: number,
	to: number,
): boolean => o.start < to && (o.end > from || (o.end === o.start && o.start >= from));

/**
 * Occurrences that overlap `[from, to)`, in start order. Cancelled events have none; a repeat
 * stops at its end (count or date), skips cancelled occurrences and applies changed ones.
 */
export function occurrencesBetween(event: CalendarEvent, from: number, to: number): Occurrence[] {
	if (event.cancelled || to <= from) return [];
	const span = event.end - event.start;
	const repeats = event.repeat !== 'none';
	const exceptions = new Map((event.exceptions ?? []).map((e) => [e.originalStart, e]));
	const endOf = endsOf(event);
	const make = (index: number, original: number, e?: EventException): Occurrence => {
		const start = e?.start ?? original;
		const end = e?.end ?? endOf(start);
		return {
			key: `${event.id}@${start}`,
			eventId: event.id,
			start,
			end,
			index,
			...(repeats ? { recurrenceId: original } : {}),
			...(e ? { changed: true } : {}),
			...(e?.title ? { title: e.title } : {}),
			...(e?.description !== undefined ? { description: e.description } : {}),
			...(event.allDay
				? { dates: { start: dayKey(start, event.zone), end: dayKey(end, event.zone) } }
				: {}),
		};
	};
	// The series is found by its exact span. A whole day is not always 24 hours (nor is a length in
	// days on the clock) and an event without length touches the range only by its start, so those
	// ask a little earlier and check each end.
	const exact = !event.allDay && span > 0 && !nominalLength(event);
	const out: Occurrence[] = [];
	for (const slot of seriesBetween(event, exact ? from : from - DAY_MS, to, MAX_OCCURRENCES)) {
		if (exceptions.has(slot.start)) continue;
		const o = make(slot.index, slot.start);
		if (exact || overlapsRange(o, from, to)) out.push(o);
	}
	// Changed occurrences may have moved into the range from outside it (or out of it).
	for (const e of exceptions.values()) {
		if (e.cancelled) continue;
		const index = seriesIndexOf(event, e.originalStart);
		if (index === null) continue;
		const o = make(index, e.originalStart, e);
		if (overlapsRange(o, from, to)) out.push(o);
	}
	return out.sort((a, b) => a.start - b.start || a.index - b.index).slice(0, MAX_OCCURRENCES);
}

/** The occurrence that starts exactly at `start` (as shown), or null. */
export const occurrenceAt = (event: CalendarEvent, start: number): Occurrence | null =>
	occurrencesBetween(event, start, start + 1).find((o) => o.start === start) ?? null;

export const REMINDER_LEAD_MS = 5 * MINUTE_MS;

/** Occurrences that start within `lead` of `now` (and have not started), soonest first. */
export function dueOccurrences<E extends CalendarEvent>(
	events: readonly E[],
	now: number,
	lead: number = REMINDER_LEAD_MS,
): { event: E; occurrence: Occurrence }[] {
	const out: { event: E; occurrence: Occurrence }[] = [];
	for (const event of events)
		for (const occurrence of occurrencesBetween(event, now, now + lead + 1))
			if (occurrence.start > now && occurrence.start - now <= lead) out.push({ event, occurrence });
	return out.sort((a, b) => a.occurrence.start - b.occurrence.start);
}
