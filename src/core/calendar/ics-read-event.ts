// One VEVENT of an imported iCalendar file as a calendar event: UID, SUMMARY, DESCRIPTION,
// LOCATION, the start and end (DTEND, or DURATION, whose days stay days on the clock; a UTC time,
// a floating time read in the importing zone, a TZID, or a date for an all-day event), STATUS, the
// repeat rule, EXDATEs, the first reminder, the organizer and the attendees. A changed occurrence
// (RECURRENCE-ID) is read the same way and joined to its series by `ics-read.ts`. Whatever the
// event cannot hold is reported through `note`. DOM-free. New code.
import { type Component, type ContentLine, unescapeText } from './ics-lines';
import { readRule } from './ics-read-rule';
import { type Wall, readDateValue, readDuration, wallAsUtc } from './ics-read-time';
import type {
	AttendeeResponse,
	CalendarEvent,
	EventAttendee,
	EventPerson,
	RecurringSeries,
} from './model';
import { MINUTE_MS, addDays, zonedToUtc } from './time-zone';

/** How the times of a TZID are read: the zone a repeat keeps, and the instant of a wall time. */
export interface ReadZone {
	zone: string;
	toUtc: (wall: Wall) => number;
}

export interface ReadContext {
	/** The zone floating times and dates are read in. */
	floating: string;
	/** The zone of a TZID (none: floating); `year` is the first year it is needed for. */
	zone: (tzid: string | undefined, year: number) => ReadZone;
	note: (text: string) => void;
}

export interface EventDraft {
	/** Its `id` is set by the caller. */
	event: CalendarEvent;
	/** The UID as written, empty when there is none. */
	uid: string;
	sequence: number;
	/** A changed occurrence: the start it had in its series. */
	recurrenceId?: number;
	/** The change applies to this and the later occurrences (RANGE=THISANDFUTURE). */
	thisAndFuture?: boolean;
}

interface Time extends ReadZone {
	ms: number;
	wall: Wall;
	date: boolean;
}

const one = (c: Component, name: string): ContentLine | undefined =>
	c.properties.find((p) => p.name === name);
const all = (c: Component, name: string): ContentLine[] =>
	c.properties.filter((p) => p.name === name);
const text = (p: ContentLine | undefined): string | undefined =>
	p ? unescapeText(p.value) : undefined;
const param = (p: ContentLine, name: string): string | undefined =>
	p.params[name]?.[0]?.trim().toUpperCase();

/** How notes name an event: its quoted title (cut to 60 characters), else `An event`. */
export const eventLabel = (title: string): string =>
	title.trim() ? `"${title.trim().slice(0, 60)}"` : 'An event';

/** A DATE or DATE-TIME value of a property (one item of a list when `value` is given). */
function readTime(p: ContentLine | undefined, ctx: ReadContext, value = p?.value): Time | null {
	const v = p ? readDateValue(value ?? '') : null;
	if (!p || !v) return null;
	if (v.date || param(p, 'VALUE') === 'DATE') {
		const wall = { ...v.wall, hour: 0, minute: 0, second: 0 };
		const toUtc = (w: Wall): number => zonedToUtc(w, ctx.floating);
		return { ms: toUtc(wall), wall, date: true, zone: ctx.floating, toUtc };
	}
	const zone = v.utc
		? { zone: 'UTC', toUtc: wallAsUtc }
		: ctx.zone(p.params.TZID?.[0], v.wall.year);
	return { ...zone, ms: zone.toUtc(v.wall), wall: v.wall, date: false };
}

/**
 * The end: DTEND, or the start plus DURATION, or one day (all-day) or no length (timed); and the
 * days of a timed DURATION, which are days on the clock for each occurrence (RFC 5545 3.8.5.3).
 */
function readEnd(c: Component, start: Time, ctx: ReadContext, label: string): [number, number?] {
	const fallback = start.date ? addDays(start.ms, 1, start.zone) : start.ms;
	const dtend = one(c, 'DTEND');
	const duration = one(c, 'DURATION');
	let end: number | null = null;
	let days: number | undefined;
	if (dtend) {
		const t = readTime(dtend, ctx);
		if (t && t.date === start.date) end = t.ms;
		else ctx.note(`${label} has an end that cannot be read with its start; it was left out`);
	} else if (duration) {
		const d = readDuration(duration.value);
		if (d) end = addDays(start.ms, d.sign * d.days, start.zone) + (start.date ? 0 : d.sign * d.ms);
		else ctx.note(`${label} has a DURATION that cannot be read; it was left out`);
		if (d && !start.date && d.sign === 1 && d.days > 0) days = d.days;
	}
	if (end !== null && (end < start.ms || (start.date && end === start.ms))) {
		ctx.note(`${label} ends before it starts; its end was left out`);
		end = null;
	}
	return end === null ? [fallback] : days ? [end, days] : [end];
}

/** UNTIL in the start's zone: a date includes the whole day (an all-day event: its start). */
function readUntil(value: string, start: Time): number | null {
	const v = readDateValue(value);
	if (!v) return null;
	if (v.utc && !v.date) return wallAsUtc(v.wall);
	const day = { ...v.wall, hour: 0, minute: 0, second: 0 };
	if (start.date) return start.toUtc(day);
	return v.date ? start.toUtc({ ...day, day: day.day + 1 }) - 1 : start.toUtc(v.wall);
}

type Series = Pick<RecurringSeries, 'repeat' | 'monthlyBy' | 'ordinal' | 'count' | 'until'>;

function readSeries(c: Component, start: Time, ctx: ReadContext, label: string): Series {
	const rules = all(c, 'RRULE');
	const single = (why: string): Series => {
		ctx.note(`${label} ${why}; only its first occurrence was imported`);
		return { repeat: 'none' };
	};
	if (rules.length > 1) return single('has several repeat rules');
	if (!rules[0]) return { repeat: 'none' };
	const { year, month, day } = start.wall;
	const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
	const rule = readRule(rules[0].value, { year, month, day, weekday });
	if ('refused' in rule) return single(rule.refused);
	const until = rule.until === undefined ? undefined : readUntil(rule.until, start);
	if (until === null) return single('has an UNTIL that cannot be read');
	// The start always counts as the first occurrence (RFC 5545), even past UNTIL.
	if (until !== undefined && until < start.ms) return { repeat: 'none' };
	return {
		repeat: rule.repeat,
		...(rule.monthlyBy && rule.ordinal !== undefined
			? { monthlyBy: rule.monthlyBy, ordinal: rule.ordinal }
			: {}),
		...(rule.count !== undefined ? { count: rule.count } : {}),
		...(until !== undefined ? { until } : {}),
	};
}

/** Cancelled occurrences; a date cancels that day's occurrence of a timed series. */
function readExdates(c: Component, start: Time, ctx: ReadContext, label: string): number[] {
	const out: number[] = [];
	for (const p of all(c, 'EXDATE'))
		for (const value of p.value.split(',')) {
			const t = readTime(p, ctx, value);
			if (!t) ctx.note(`${label} has an EXDATE that cannot be read; it was left out`);
			else if (start.date)
				out.push(
					t.date ? t.ms : zonedToUtc({ ...t.wall, hour: 0, minute: 0, second: 0 }, ctx.floating),
				);
			else if (t.date)
				out.push(
					start.toUtc({ ...start.wall, year: t.wall.year, month: t.wall.month, day: t.wall.day }),
				);
			else out.push(t.ms);
		}
	return out;
}

/**
 * Minutes before the start of the first reminder (VALARM) that is relative to the start and alerts
 * the person: one shown (DISPLAY, or no ACTION), or a sound, which is shown instead. An email or any
 * other action is no reminder this calendar keeps, and a reminder's repeats are not kept: each is
 * reported (RFC 5545 3.6.6).
 */
function readReminder(c: Component, ctx: ReadContext): number | undefined {
	let reminder: number | undefined;
	for (const alarm of c.components.filter((x) => x.name === 'VALARM')) {
		const action = one(alarm, 'ACTION')?.value.trim().toUpperCase() || 'DISPLAY';
		if (action !== 'DISPLAY' && action !== 'AUDIO') {
			ctx.note(`ACTION:${action} reminders are not imported`);
			continue;
		}
		if (action === 'AUDIO') ctx.note('A sound reminder is imported as one the calendar shows');
		if (one(alarm, 'REPEAT')) ctx.note('A reminder is imported without its repeats');
		const trigger = one(alarm, 'TRIGGER');
		const relative =
			trigger && param(trigger, 'VALUE') !== 'DATE-TIME' && param(trigger, 'RELATED') !== 'END';
		const d = relative ? readDuration(trigger.value) : null;
		let minutes: number | null = null;
		if (d) {
			const total = d.days * 1440 + d.ms / MINUTE_MS;
			// Minutes before the start: `-PT15M` is 15 and a trigger after the start is negative (a zero
			// stays 0, not -0).
			minutes = d.sign === -1 || total === 0 ? total : -total;
		}
		if (minutes === null || minutes < 0)
			ctx.note('Reminders at a set time, after the start or before the end are not imported');
		else if (reminder === undefined) reminder = minutes;
		else if (reminder !== minutes) ctx.note('Only the first reminder of an event is imported');
	}
	return reminder;
}

function readPerson(p: ContentLine): EventPerson {
	const address = p.value.trim();
	const email = /^mailto:/iu.test(address) ? address.slice(7).trim() : '';
	const name = p.params.CN?.[0]?.trim() || email || address;
	return { name, ...(email ? { email } : {}) };
}

const RESPONSES: Record<string, AttendeeResponse> = {
	'NEEDS-ACTION': 'needs-action',
	ACCEPTED: 'accepted',
	DECLINED: 'declined',
	TENTATIVE: 'tentative',
	DELEGATED: 'delegated',
};

function readAttendee(p: ContentLine): EventAttendee {
	const partstat = param(p, 'PARTSTAT');
	// An unknown answer is read as no answer yet (RFC 5545 section 3.2.12).
	const response = partstat === undefined ? undefined : (RESPONSES[partstat] ?? 'needs-action');
	const role = param(p, 'ROLE');
	return {
		...readPerson(p),
		...(response ? { response } : {}),
		...(role === 'OPT-PARTICIPANT' || role === 'NON-PARTICIPANT' ? { optional: true } : {}),
	};
}

/** Properties that are read, or that hold nothing an event shows (DTSTAMP and the like). */
const READ = new Set([
	'UID',
	'DTSTART',
	'DTEND',
	'DURATION',
	'SUMMARY',
	'DESCRIPTION',
	'LOCATION',
	'STATUS',
	'RRULE',
	'EXDATE',
	'RECURRENCE-ID',
	'ORGANIZER',
	'ATTENDEE',
	'SEQUENCE',
	'DTSTAMP',
	'CREATED',
	'LAST-MODIFIED',
]);
/** Properties whose default value says nothing. */
const DEFAULTS: Record<string, string> = { TRANSP: 'OPAQUE', CLASS: 'PUBLIC', PRIORITY: '0' };

/** A VEVENT, or null (noted) when it has no start that can be read. */
export function readEvent(c: Component, ctx: ReadContext): EventDraft | null {
	const title = text(one(c, 'SUMMARY')) ?? '';
	const label = eventLabel(title);
	const start = readTime(one(c, 'DTSTART'), ctx);
	if (!start) {
		ctx.note(`${label} has no start that can be read and was skipped`);
		return null;
	}
	for (const p of c.properties)
		if (!READ.has(p.name) && DEFAULTS[p.name] !== p.value.trim().toUpperCase())
			ctx.note(`${p.name} is not imported`);
	for (const inner of c.components)
		if (inner.name !== 'VALARM') ctx.note(`${inner.name} inside an event is not imported`);
	const status = one(c, 'STATUS')?.value.trim().toUpperCase();
	if (status && status !== 'CONFIRMED' && status !== 'CANCELLED')
		ctx.note(`STATUS:${status} is not imported`);
	const series = readSeries(c, start, ctx, label);
	const exdates = series.repeat === 'none' ? [] : readExdates(c, start, ctx, label);
	const location = text(one(c, 'LOCATION'));
	const organizer = one(c, 'ORGANIZER');
	const attendees = all(c, 'ATTENDEE').map(readAttendee);
	const reminder = readReminder(c, ctx);
	const recurrence = one(c, 'RECURRENCE-ID');
	const recurrenceId = recurrence ? readTime(recurrence, ctx) : null;
	if (recurrence && !recurrenceId) {
		ctx.note(`${label} changes an occurrence whose RECURRENCE-ID cannot be read; it was skipped`);
		return null;
	}
	const sequence = Number(one(c, 'SEQUENCE')?.value);
	const [end, nominalDays] = readEnd(c, start, ctx, label);
	const event: CalendarEvent = {
		id: '',
		title,
		description: text(one(c, 'DESCRIPTION')) ?? '',
		zone: start.zone,
		start: start.ms,
		end,
		...(nominalDays ? { nominalDays } : {}),
		...series,
		...(exdates.length
			? {
					exceptions: [...new Set(exdates)]
						.sort((a, b) => a - b)
						.map((originalStart) => ({ originalStart, cancelled: true })),
				}
			: {}),
		...(location ? { location } : {}),
		...(start.date ? { allDay: true } : {}),
		...(status === 'CANCELLED' ? { cancelled: true } : {}),
		...(reminder !== undefined ? { reminder } : {}),
		...(organizer ? { organizer: readPerson(organizer) } : {}),
		...(attendees.length ? { attendees } : {}),
	};
	return {
		event,
		uid: text(one(c, 'UID'))?.trim() ?? '',
		sequence: Number.isInteger(sequence) ? sequence : 0,
		...(recurrenceId ? { recurrenceId: recurrenceId.ms } : {}),
		...(recurrence && param(recurrence, 'RANGE') === 'THISANDFUTURE'
			? { thisAndFuture: true }
			: {}),
	};
}
