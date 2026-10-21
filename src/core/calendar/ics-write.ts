// iCalendar (RFC 5545) writing. The value formats (UTC and zoned date-times, dates, durations,
// TEXT escaping, folding at 75 octets), the repeat rule of a series, and `eventsToIcs`, which writes
// one VCALENDAR with a VEVENT per event. A timed event carries its zone (TZID) with a VTIMEZONE
// block derived from the platform's zone data, so a repeat keeps its wall-clock time across
// daylight saving in any calendar program; a UTC event uses plain UTC times and an all-day event
// dates. A repeat is one event with an RRULE (COUNT or UNTIL), cancelled occurrences are EXDATEs
// and a changed occurrence is an overriding event with the same UID and a RECURRENCE-ID.
// DOM-free. The value helpers and the RRULE moved from src/core/teams/ics.ts; the dates, durations,
// people and `eventsToIcs` are new.
import { timezoneBlocks } from './ics-write-zone';
import type { CalendarEvent, EventAttendee, EventPerson, RecurringSeries } from './model';
import { nominalLength, occurrenceEnd } from './occurrences';
import { ordinalOfDay } from './recurrence-calendar';
import { MINUTE_MS, isValidZone, zonedParts } from './time-zone';

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** `20261015T140000Z` */
export function icsUtc(ms: number): string {
	const d = new Date(ms);
	return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export const icsEscape = (text: string): string =>
	text
		.replace(/\\/gu, '\\\\')
		.replace(/\r\n|\r|\n/gu, '\\n')
		.replace(/;/gu, '\\;')
		.replace(/,/gu, '\\,');

/** Fold a content line at 75 octets, continuing with a space (RFC 5545 section 3.1). */
export function icsFold(line: string): string[] {
	const encoder = new TextEncoder();
	const out: string[] = [];
	let current = '';
	let bytes = 0;
	for (const ch of line) {
		const size = encoder.encode(ch).length;
		const limit = out.length === 0 ? 75 : 74;
		if (bytes + size > limit) {
			out.push(current);
			current = '';
			bytes = 0;
		}
		current += ch;
		bytes += size;
	}
	out.push(current);
	return out.map((part, i) => (i === 0 ? part : ` ${part}`));
}

const UTC_ZONES = new Set(['UTC', 'Etc/UTC', 'GMT', 'Etc/GMT']);

/** Zones whose times are written as plain UTC (`...Z`), without a TZID. */
export const isUtcZone = (zone: string): boolean => UTC_ZONES.has(zone);

/** `20261015T090000`: the wall time of an instant in a zone, without a suffix. */
export function icsLocal(ms: number, zone: string): string {
	const p = zonedParts(ms, zone);
	return `${pad(p.year, 4)}${pad(p.month)}${pad(p.day)}T${pad(p.hour)}${pad(p.minute)}${pad(p.second)}`;
}

/** Control characters other than tabs and line breaks, which iCalendar text may not hold. */
const controls = (text: string): string =>
	text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');

/** A parameter value: RFC 6868 escapes for `^`, a line break and a quote, quoted when needed. */
function paramValue(text: string): string {
	const value = controls(text)
		.replace(/\^/gu, '^^')
		.replace(/\r\n|\r|\n/gu, '^n')
		.replace(/"/gu, "^'");
	return /[,;:]/u.test(value) ? `"${value}"` : value;
}

/** `TZID=<zone>`, quoted when it holds a colon (`+01:00`), semicolon or comma (RFC 5545 3.2). */
const tzidParam = (zone: string): string => `TZID=${paramValue(zone)}`;

/** A date-time property: `DTSTART;TZID=America/New_York:20261015T090000`, or `...:...Z` in UTC. */
export function icsDateTime(name: string, ms: number, zone: string): string {
	return UTC_ZONES.has(zone)
		? `${name}:${icsUtc(ms)}`
		: `${name};${tzidParam(zone)}:${icsLocal(ms, zone)}`;
}

/** `20261015`: the wall date of an instant in a zone. */
export const icsDate = (ms: number, zone: string): string => icsLocal(ms, zone).slice(0, 8);

/** `T2H30M`: whole seconds as hours, minutes and seconds; empty for none. */
function icsTime(total: number): string {
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total - hours * 3600) / 60);
	const seconds = total - hours * 3600 - minutes * 60;
	const time = `${hours ? `${hours}H` : ''}${minutes ? `${minutes}M` : ''}${seconds ? `${seconds}S` : ''}`;
	return time ? `T${time}` : '';
}

/** A duration such as `PT5M`, `P1DT2H` or `-PT15M`, to the second. */
export function icsDuration(ms: number): string {
	const rest = Math.round(Math.abs(ms) / 1000);
	if (rest === 0) return 'PT0S';
	const days = Math.floor(rest / 86_400);
	return `${ms < 0 ? '-' : ''}P${days ? `${days}D` : ''}${icsTime(rest - days * 86_400)}`;
}

/** A display alarm `minutes` before the start. */
export const icsAlarm = (description: string, minutes: number): string[] => [
	'BEGIN:VALARM',
	'ACTION:DISPLAY',
	`DESCRIPTION:${icsEscape(description)}`,
	`TRIGGER:${icsDuration(-minutes * MINUTE_MS)}`,
	'END:VALARM',
];

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * The BYMONTHDAY / BYDAY / BYMONTH parts of a monthly or yearly rule, from the start's wall date in
 * the series' zone. RFC 5545 skips a month that lacks the date, which is what the app does.
 */
function calendarParts(series: RecurringSeries): string {
	if (series.repeat !== 'monthly' && series.repeat !== 'yearly') return '';
	const p = zonedParts(series.start, series.zone);
	if (series.repeat === 'yearly') return `;BYMONTH=${p.month};BYMONTHDAY=${p.day}`;
	if (series.monthlyBy !== 'weekday') return `;BYMONTHDAY=${p.day}`;
	const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
	return `;BYDAY=${series.ordinal ?? ordinalOfDay(p.day)}${BYDAY[weekday]}`;
}

/**
 * The RRULE of a repeating series and the EXDATE of its cancelled occurrences, in the series'
 * zone (UTC times for a UTC series, dates for an all-day one); nothing when it does not repeat.
 */
export function icsRecurrence(
	series: RecurringSeries & Pick<CalendarEvent, 'allDay' | 'exceptions'>,
): string[] {
	if (series.repeat === 'none') return [];
	const freq = series.repeat.toUpperCase();
	// UNTIL is in UTC when DTSTART names a zone, a date when DTSTART is one (RFC 5545 3.3.10).
	const until = (ms: number): string => (series.allDay ? icsDate(ms, series.zone) : icsUtc(ms));
	const end =
		series.count !== undefined
			? `;COUNT=${series.count}`
			: series.until !== undefined
				? `;UNTIL=${until(series.until)}`
				: '';
	const utc = UTC_ZONES.has(series.zone);
	const cancelled = (series.exceptions ?? []).filter((e) => e.cancelled);
	const exdates = cancelled.map((e) =>
		series.allDay
			? icsDate(e.originalStart, series.zone)
			: utc
				? icsUtc(e.originalStart)
				: icsLocal(e.originalStart, series.zone),
	);
	const exdate = series.allDay
		? `EXDATE;VALUE=DATE:${exdates.join(',')}`
		: utc
			? `EXDATE:${exdates.join(',')}`
			: `EXDATE;${tzidParam(series.zone)}:${exdates.join(',')}`;
	return [`RRULE:FREQ=${freq}${calendarParts(series)}${end}`, ...(exdates.length ? [exdate] : [])];
}

/** A safe download name such as `Weekly-sync.ics`. */
export const icsFileName = (event: Pick<CalendarEvent, 'title'>, fallback = 'event'): string =>
	`${
		event.title
			.replace(/[^\w.-]+/gu, '-')
			.replace(/^-|-$/gu, '')
			.slice(0, 60) || fallback
	}.ics`;

export interface EventsToIcsOptions {
	/** The PRODID of the file, such as `-//Example//Calendar//EN`. */
	prodId: string;
	/** An event without an imported `uid` is written as `<id>@<uidDomain>`. */
	uidDomain: string;
	/** DTSTAMP; the clock by default. */
	now?: number;
	/**
	 * The METHOD of a scheduling message (RFC 5546), such as `REQUEST` or `CANCEL`. None by default:
	 * the file is then a calendar snapshot and no scheduling is meant (RFC 5545 3.7.2). Meeting the
	 * method's rules is the caller's part (`PUBLISH`, for one, needs an ORGANIZER and no ATTENDEE,
	 * RFC 5546 3.2.1).
	 */
	method?: string;
	/** Written on events that have no organizer of their own. */
	organizer?: EventPerson;
	/** Written on events that have no attendees of their own. */
	attendees?: readonly EventAttendee[];
}

/** `ORGANIZER;CN=Ada:mailto:ada@example.com`; null for a person without a usable address. */
function personLine(
	property: string,
	person: EventPerson,
	params: readonly string[] = [],
): string | null {
	const email = person.email?.trim() ?? '';
	if (!/^[^\s@:;,"<>]+@[^\s@:;,"<>]+$/u.test(email)) return null;
	const cn = person.name.trim() ? [`CN=${paramValue(person.name.trim())}`] : [];
	return `${[property, ...cn, ...params].join(';')}:mailto:${email}`;
}

function peopleLines(event: CalendarEvent, options: EventsToIcsOptions): string[] {
	const organizer = event.organizer ?? options.organizer;
	const lines = organizer ? [personLine('ORGANIZER', organizer)] : [];
	for (const a of event.attendees ?? options.attendees ?? [])
		lines.push(
			personLine('ATTENDEE', a, [
				...(a.optional ? ['ROLE=OPT-PARTICIPANT'] : []),
				...(a.response ? [`PARTSTAT=${a.response.toUpperCase()}`] : []),
			]),
		);
	return lines.filter((l): l is string => l !== null);
}

function eventLines(event: CalendarEvent, options: EventsToIcsOptions, stamp: string): string[] {
	const zone = isValidZone(event.zone) ? event.zone : 'UTC';
	const at = { ...event, zone };
	const time = (name: string, ms: number): string =>
		event.allDay ? `${name};VALUE=DATE:${icsDate(ms, zone)}` : icsDateTime(name, ms, zone);
	// DTEND must be later than DTSTART (RFC 5545 3.8.2.2). Without it, a timed event ends where it
	// starts and an all-day one lasts its day (3.6.1), which is what the reader takes it for. A
	// length in days on the clock is a DURATION, which is nominal for each occurrence (3.8.5.3).
	const length = nominalLength(at);
	const dtend = (start: number, end: number): string[] =>
		(event.allDay ? icsDate(end, zone) > icsDate(start, zone) : end > start)
			? [time('DTEND', end)]
			: [];
	const uid = `UID:${icsEscape(event.uid ?? `${event.id}@${options.uidDomain}`)}`;
	const status = `STATUS:${event.cancelled ? 'CANCELLED' : 'CONFIRMED'}`;
	const people = peopleLines(event, options);
	const text = (value: string): string => icsEscape(controls(value));
	const body = (title: string, description: string): string[] => [
		`SUMMARY:${text(title)}`,
		...(description ? [`DESCRIPTION:${text(description)}`] : []),
		...(event.location ? [`LOCATION:${text(event.location)}`] : []),
		...people,
	];
	const alarm = (title: string): string[] =>
		event.reminder !== undefined && Number.isFinite(event.reminder)
			? icsAlarm(controls(title), event.reminder)
			: [];
	const changed =
		event.repeat === 'none' ? [] : (event.exceptions ?? []).filter((e) => !e.cancelled);
	return [
		'BEGIN:VEVENT',
		uid,
		stamp,
		time('DTSTART', event.start),
		...(length
			? [`DURATION:P${length.days}D${icsTime(Math.round(length.rest / 1000))}`]
			: dtend(event.start, event.end)),
		...body(event.title, event.description),
		...icsRecurrence(at),
		status,
		...alarm(event.title),
		'END:VEVENT',
		...changed.flatMap((e) => {
			const start = e.start ?? e.originalStart;
			const title = e.title || event.title;
			return [
				'BEGIN:VEVENT',
				uid,
				stamp,
				time('RECURRENCE-ID', e.originalStart),
				time('DTSTART', start),
				...dtend(start, e.end ?? occurrenceEnd(at, start)),
				...body(title, e.description ?? event.description),
				status,
				...alarm(title),
				'END:VEVENT',
			];
		}),
	];
}

/** The `.ics` text (CRLF line endings) of the events, with their changed occurrences. */
export function eventsToIcs(events: readonly CalendarEvent[], options: EventsToIcsOptions): string {
	const now = options.now ?? Date.now();
	const stamp = `DTSTAMP:${icsUtc(now)}`;
	// One VTIMEZONE per zone a timed event uses, for every year it is needed in.
	const zoned = events.filter((e) => !e.allDay && isValidZone(e.zone) && !UTC_ZONES.has(e.zone));
	const method =
		options.method && /^[A-Za-z-]{1,40}$/u.test(options.method)
			? [`METHOD:${options.method.toUpperCase()}`]
			: [];
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		`PRODID:${icsEscape(options.prodId)}`,
		'CALSCALE:GREGORIAN',
		...method,
		...timezoneBlocks(zoned, now),
		...events.flatMap((event) => eventLines(event, options, stamp)),
		'END:VCALENDAR',
	];
	return `${lines.flatMap(icsFold).join('\r\n')}\r\n`;
}
