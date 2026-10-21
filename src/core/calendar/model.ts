// The calendar model every product shares: a repeating series (what recurrence reads), the
// exceptions to it and a calendar event (a series with a title, details, a place, a reminder and
// the people invited). Pure data, no DOM, no storage. A product keeps its own richer row (a team
// meeting has an organiser id, attendees from the workspace roster, a channel and a chat) and
// passes it wherever a `CalendarEvent` is read. The exception types moved from
// src/core/teams/meeting-exceptions.ts; the rest is new code.

/** How a series repeats. */
export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export const REPEATS: readonly Repeat[] = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

/** Monthly repeats: on the same date (`date`) or on the same weekday by ordinal (`weekday`). */
export type MonthlyBy = 'date' | 'weekday';

/** The fields of a repeating series that recurrence reads. */
export interface RecurringSeries {
	/** UTC milliseconds. */
	start: number;
	end: number;
	/** The IANA zone the series keeps its wall-clock time in. */
	zone: string;
	repeat: Repeat;
	/**
	 * Monthly repeats only: on the same date (`date`, the default) or on the same weekday by
	 * ordinal (`weekday`, "the third Tuesday"). Yearly repeats are always on the date.
	 */
	monthlyBy?: MonthlyBy;
	/** With `monthlyBy: 'weekday'`: 1 to 4, or -1 for the last. Defaults to the start's own. */
	ordinal?: number;
	/** The series ends once an occurrence would start after this instant. Never with `count`. */
	until?: number;
	/** The series has this many occurrences in all. Never with `until`. */
	count?: number;
}

/**
 * One occurrence of a repeating series that was cancelled or changed (a new time, title or
 * details), keyed by the occurrence's original start, which is what iCalendar calls RECURRENCE-ID.
 */
export interface EventException {
	/** UTC start the occurrence would have had without the exception. */
	originalStart: number;
	cancelled: boolean;
	/** Overrides for a changed occurrence. */
	start?: number;
	end?: number;
	title?: string;
	description?: string;
}

/** What a change to a single occurrence may set. */
export interface OccurrencePatch {
	start?: number;
	end?: number;
	title?: string;
	description?: string;
}

/** A person on an event: a display name and, when known, an e-mail address. */
export interface EventPerson {
	name: string;
	email?: string;
}

/** An invitee's answer (iCalendar PARTSTAT). */
export type AttendeeResponse = 'needs-action' | 'accepted' | 'declined' | 'tentative' | 'delegated';

export interface EventAttendee extends EventPerson {
	response?: AttendeeResponse;
	/** Invited as optional (iCalendar ROLE=OPT-PARTICIPANT). */
	optional?: boolean;
}

/**
 * An event in a calendar. `start` and `end` are instants; `zone` is where a repeat keeps its
 * wall-clock time. An all-day event starts at the start of its first day and ends at the start of
 * the day after its last one, both in `zone` (iCalendar `VALUE=DATE`, the end exclusive), so it
 * may span several days.
 */
export interface CalendarEvent extends RecurringSeries {
	id: string;
	title: string;
	description: string;
	location?: string;
	allDay?: boolean;
	/** Single occurrences that were cancelled or changed. */
	exceptions?: readonly EventException[];
	/** The whole event (every occurrence) was cancelled. */
	cancelled?: boolean;
	/** Minutes before each occurrence starts that a reminder is due. */
	reminder?: number;
	organizer?: EventPerson;
	attendees?: readonly EventAttendee[];
	/** The iCalendar UID an import read; an export writes it back so other calendars match it. */
	uid?: string;
}
