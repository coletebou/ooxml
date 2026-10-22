// The mail calendar's event store: the shared `CalendarEvent` (`ooxml-core/calendar`) kept in memory
// and optionally persisted, re-validated when read back. The calendar views, the recurrence rules
// and the iCalendar reader and writer all live in the calendar area; this only stores. New code.
import type {
	AttendeeResponse,
	CalendarEvent,
	EventAttendee,
	EventException,
	EventPerson,
} from '../calendar/model';
import { REPEATS } from '../calendar/model';
import { WEEKDAY_ORDINALS } from '../calendar/recurrence-calendar';
import { DAY_MS, MAX_INSTANT, MINUTE_MS, isValidZone } from '../calendar/time-zone';
import { createMemoryRecordStore, type MemoryStoreOptions, type RecordStore } from './record-store';

export type CalendarStore = RecordStore<CalendarEvent>;

const MAX_TEXT = 20_000;
const RESPONSES: readonly AttendeeResponse[] = [
	'needs-action',
	'accepted',
	'declined',
	'tentative',
	'delegated',
];
/** The longest a stored length in days or a reminder may be: half the instants a `Date` holds. */
const LONGEST_MS = MAX_INSTANT / 2;

const text = (value: unknown, max = MAX_TEXT): string | null =>
	typeof value === 'string' ? value.slice(0, max) : null;
/** An instant a `Date` holds (and so every calendar function can read). */
const instant = (value: unknown): value is number =>
	typeof value === 'number' && Math.abs(value) <= MAX_INSTANT;
const whole = (value: unknown, max: number): value is number =>
	Number.isInteger(value) && (value as number) > 0 && (value as number) <= max;
const boolean = (value: unknown): value is boolean => typeof value === 'boolean';
/** Minutes before a start, no more than any instant can be moved by. */
const reminder = (value: unknown): value is number =>
	typeof value === 'number' && value >= 0 && value <= LONGEST_MS / MINUTE_MS;
const record = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;

/** `value` under `name`, or nothing when there is none (`null`, `undefined` or `false`). */
const field = <K extends string, V>(name: K, value: V | null | undefined | false) =>
	(value === null || value === undefined || value === false ? {} : { [name]: value }) as Partial<
		Record<K, V>
	>;

function person(raw: unknown): EventPerson | null {
	const value = record(raw);
	const name = value && text(value.name, 500);
	if (name === null || !value) return null;
	return { name, ...field('email', text(value.email, 500)) };
}

function attendee(raw: unknown): EventAttendee | null {
	const base = person(raw);
	if (!base) return null;
	const value = raw as Record<string, unknown>;
	const response = RESPONSES.find((answer) => answer === value.response);
	return {
		...base,
		...field('response', response),
		...(boolean(value.optional) ? { optional: value.optional } : {}),
	};
}

function exception(raw: unknown): EventException | null {
	const value = record(raw);
	if (!value || !instant(value.originalStart)) return null;
	return {
		originalStart: value.originalStart,
		cancelled: value.cancelled === true,
		...(instant(value.start) ? { start: value.start } : {}),
		...(instant(value.end) ? { end: value.end } : {}),
		...field('title', text(value.title, 500)),
		...field('description', text(value.description)),
	};
}

/**
 * A stored event, or `null` when the record cannot be one: its times are not instants a `Date`
 * holds, or it ends before it starts. Every other field is checked against the model, and one of
 * the wrong shape is left out (a repeat this calendar does not know is none), so that a record
 * damaged in storage, or written by another program, can still be shown; a zone this browser does
 * not know is kept as UTC, as an imported one is. Fields the model does not have are not kept.
 */
export function sanitizeEvent(raw: unknown): CalendarEvent | null {
	const value = record(raw);
	if (!value) return null;
	const id = text(value.id, 256);
	const { start, end } = value;
	if (!id || !instant(start) || !instant(end) || end < start) return null;
	const zone = isValidZone(value.zone) ? value.zone : 'UTC';
	const repeat = REPEATS.find((kind) => kind === value.repeat) ?? 'none';
	const monthlyBy = (['date', 'weekday'] as const).find((by) => by === value.monthlyBy);
	const ordinal = WEEKDAY_ORDINALS.find((n) => n === value.ordinal);
	const exceptions = Array.isArray(value.exceptions) ? value.exceptions.map(exception) : null;
	const attendees = Array.isArray(value.attendees) ? value.attendees.map(attendee) : null;
	return {
		id,
		title: text(value.title, 500) ?? '',
		description: text(value.description) ?? '',
		zone,
		start,
		end,
		repeat,
		...field('location', text(value.location, 500)),
		...(boolean(value.allDay) ? { allDay: value.allDay } : {}),
		...field('monthlyBy', monthlyBy),
		...field('ordinal', ordinal),
		...(instant(value.until) ? { until: value.until } : {}),
		...(whole(value.count, Number.MAX_SAFE_INTEGER) ? { count: value.count } : {}),
		...(whole(value.nominalDays, LONGEST_MS / DAY_MS) ? { nominalDays: value.nominalDays } : {}),
		...(exceptions ? { exceptions: exceptions.filter((e) => e !== null) } : {}),
		...(boolean(value.cancelled) ? { cancelled: value.cancelled } : {}),
		...(reminder(value.reminder) ? { reminder: value.reminder } : {}),
		...field('organizer', person(value.organizer)),
		...(attendees ? { attendees: attendees.filter((a) => a !== null) } : {}),
		...field('uid', text(value.uid, 1024)),
	};
}

/** A calendar in memory, optionally persisted (see `createMemoryRecordStore`). */
export function createMemoryCalendarStore(
	options: MemoryStoreOptions<CalendarEvent> = {},
): CalendarStore {
	return createMemoryRecordStore({
		...options,
		key: options.key ?? 'ooxml-mail:calendar',
		sanitize: sanitizeEvent,
	});
}
