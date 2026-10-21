import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseIcs } from './ics-read';
import { eventsToIcs } from './ics-write';
import type { CalendarEvent, EventException, Repeat } from './model';
import { occurrenceEnd } from './occurrences';
import { seriesStart, withinSeries } from './recurrence';
import { repeatChoices } from './recurrence-calendar';
import { addDays, isValidZone, zonedParts, zonedToUtc } from './time-zone';

const NY = 'America/New_York';
const ZONES = [NY, 'Europe/Berlin', 'Asia/Tokyo', 'UTC', 'Australia/Sydney', 'Asia/Kolkata'];

/** Fragments real files are made of, to build broken calendars from. */
const FRAGMENTS = [
	'BEGIN:VCALENDAR',
	'END:VCALENDAR',
	'BEGIN:VEVENT',
	'END:VEVENT',
	'BEGIN:VTIMEZONE',
	'END:VTIMEZONE',
	'BEGIN:STANDARD',
	'END:STANDARD',
	'BEGIN:VALARM',
	'END:VALARM',
	'TZID:Example Zone',
	'TZOFFSETFROM:+0100',
	'TZOFFSETTO:+0200',
	'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
	'DTSTART:16010101T020000',
	'DTSTART:20261020T090000Z',
	'DTSTART;TZID=Example Zone:20261020T090000',
	'DTSTART;VALUE=DATE:20261020',
	'DTEND:20261020T080000Z',
	'DURATION:P1DT2H',
	'DURATION:PT',
	'UID:a',
	'UID:b',
	'RECURRENCE-ID:20261021T090000Z',
	'RRULE:FREQ=DAILY;COUNT=3',
	'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TU',
	'RRULE:FREQ=MONTHLY;BYDAY=-1FR;UNTIL=2027',
	'EXDATE:20261021T090000Z,bad',
	'STATUS:CANCELLED',
	'TRIGGER:-PT15M',
	'TRIGGER;VALUE=DATE-TIME:x',
	'ATTENDEE;CN="unterminated:mailto:x@y.example',
	'ORGANIZER:mailto:',
	'SUMMARY:a\\nb\\,c',
	'X-THING;A="b;c":d',
	' folded continuation',
	'no colon',
	'',
];

/** A realistic file (a zone named by its rules, a weekly series with its changes, an all-day event). */
const SAMPLE = [
	'BEGIN:VCALENDAR',
	'VERSION:2.0',
	'BEGIN:VTIMEZONE',
	'TZID:Example Standard Time',
	'BEGIN:STANDARD',
	'DTSTART:16010101T030000',
	'TZOFFSETFROM:+0200',
	'TZOFFSETTO:+0100',
	'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
	'END:STANDARD',
	'BEGIN:DAYLIGHT',
	'DTSTART:16010101T020000',
	'TZOFFSETFROM:+0100',
	'TZOFFSETTO:+0200',
	'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
	'END:DAYLIGHT',
	'END:VTIMEZONE',
	'BEGIN:VEVENT',
	'UID:s',
	'SUMMARY:Sync',
	'DTSTART;TZID=Example Standard Time:20260302T090000',
	'DTEND;TZID=Example Standard Time:20260302T093000',
	'RRULE:FREQ=WEEKLY;UNTIL=20260427T070000Z',
	'EXDATE;TZID=Example Standard Time:20260316T090000',
	'ORGANIZER;CN="Doe, Jane":mailto:jane@example.com',
	'BEGIN:VALARM',
	'TRIGGER:-PT15M',
	'END:VALARM',
	'END:VEVENT',
	'BEGIN:VEVENT',
	'UID:s',
	'RECURRENCE-ID;TZID=Example Standard Time:20260323T090000',
	'DTSTART;TZID=Example Standard Time:20260323T140000',
	'DTEND;TZID=Example Standard Time:20260323T150000',
	'SUMMARY:Moved',
	'END:VEVENT',
	'BEGIN:VEVENT',
	'UID:h',
	'DTSTART;VALUE=DATE:20260403',
	'DTEND;VALUE=DATE:20260407',
	'SUMMARY:Holiday',
	'END:VEVENT',
	'END:VCALENDAR',
];

/** The sample with lines dropped, repeated, cut short, swapped or replaced by fragments. */
const mutated = fc
	.array(
		fc.record({
			at: fc.nat(),
			kind: fc.constantFrom('drop', 'repeat', 'cut', 'swap', 'insert'),
			fragment: fc.constantFrom(...FRAGMENTS),
			cut: fc.nat(),
		}),
		{ maxLength: 8 },
	)
	.map((ops) => {
		const lines = [...SAMPLE];
		for (const op of ops) {
			const i = op.at % lines.length;
			const line = lines[i] ?? '';
			if (op.kind === 'drop') lines.splice(i, 1);
			else if (op.kind === 'repeat') lines.splice(i, 0, line);
			else if (op.kind === 'cut') lines[i] = line.slice(0, op.cut % (line.length + 1));
			else if (op.kind === 'swap') lines.splice(i, 2, lines[i + 1] ?? '', line);
			else lines.splice(i, 0, op.fragment);
			if (!lines.length) break;
		}
		return lines.join('\r\n');
	});

describe('the iCalendar reader on any input', () => {
	it('never throws and only returns well-formed events', () => {
		const text = fc.oneof(
			mutated,
			fc.string({ unit: 'grapheme', maxLength: 400 }),
			fc
				.array(fc.oneof(fc.constantFrom(...FRAGMENTS), fc.string({ maxLength: 30 })), {
					maxLength: 60,
				})
				.chain((lines) => fc.constantFrom('\r\n', '\n', '\r').map((eol) => lines.join(eol))),
		);
		fc.assert(
			fc.property(text, (input) => {
				const { events, unsupported } = parseIcs(input, { zone: NY });
				expect(Array.isArray(unsupported)).toBe(true);
				expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
				for (const e of events) {
					expect(Number.isFinite(e.start) && Number.isFinite(e.end) && e.end >= e.start).toBe(true);
					expect(isValidZone(e.zone)).toBe(true);
					expect(e.id).not.toBe('');
				}
			}),
			{ numRuns: 1000 },
		);
	});
});

/** Text a calendar program keeps as it is: no control characters, no lone carriage returns. */
const text = (minLength = 0): fc.Arbitrary<string> =>
	fc
		.string({ unit: 'grapheme', minLength, maxLength: 40 })
		.map((s) => s.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/gu, ''))
		.filter((s) => s.length >= minLength);
const name = text(1)
	.map((s) => s.replace(/\n/gu, ' ').trim())
	.filter(Boolean);
const email = fc.constantFrom('ada@example.com', 'bob@example.org', 'jane.doe@mail.example');

/**
 * Whether the local time of an instant names only it. A time in the hour a clock change repeats
 * names two instants, and an iCalendar local time cannot say which one it means.
 */
const unambiguous = (t: number, zone: string): boolean =>
	zonedToUtc(zonedParts(t, zone), zone) === t;

/** An event in the form the writer and the reader agree on. */
const event = fc
	.record({
		zone: fc.constantFrom(...ZONES),
		allDay: fc.boolean(),
		year: fc.integer({ min: 2000, max: 2040 }),
		month: fc.integer({ min: 1, max: 12 }),
		day: fc.integer({ min: 1, max: 28 }),
		hour: fc.integer({ min: 0, max: 23 }),
		minute: fc.integer({ min: 0, max: 59 }),
		minutes: fc.integer({ min: 0, max: 600 }),
		days: fc.integer({ min: 1, max: 5 }),
		nominal: fc.boolean(),
		repeat: fc.constantFrom<Repeat>('none', 'daily', 'weekly', 'monthly', 'yearly'),
		byWeekday: fc.boolean(),
		end: fc.constantFrom('none', 'count', 'until'),
		count: fc.integer({ min: 1, max: 30 }),
		untilSteps: fc.integer({ min: 0, max: 20 }),
		title: text(),
		description: text(),
		location: fc.option(text(1), { nil: undefined }),
		reminder: fc.option(fc.integer({ min: 0, max: 2880 }), { nil: undefined }),
		organizer: fc.option(fc.record({ name, email }), { nil: undefined }),
		attendees: fc.array(
			fc.record({
				name,
				email,
				response: fc.option(fc.constantFrom('accepted', 'declined', 'tentative', 'needs-action'), {
					nil: undefined,
				}),
				optional: fc.option(fc.constant(true), { nil: undefined }),
			}),
			{ maxLength: 3 },
		),
		changes: fc.array(
			fc.record({
				index: fc.integer({ min: 1, max: 12 }),
				cancelled: fc.boolean(),
				shift: fc.integer({ min: -3000, max: 3000 }),
				title: fc.option(text(1), { nil: undefined }),
				description: fc.option(text(), { nil: undefined }),
			}),
			{ maxLength: 4 },
		),
	})
	.map((r): CalendarEvent => {
		const zone = r.allDay ? NY : r.zone;
		const wall = {
			year: r.year,
			month: r.month,
			day: r.day,
			...(r.allDay ? {} : { hour: r.hour, minute: r.minute }),
		};
		const start = zonedToUtc(wall, zone);
		// A length in days on the clock is written as a DURATION, never as a local end time.
		const nominal = r.nominal && !r.allDay;
		let end = r.allDay
			? zonedToUtc({ ...wall, day: r.day + r.days }, zone)
			: (nominal ? addDays(start, r.days, zone) : start) + r.minutes * 60_000;
		if (!nominal && !unambiguous(end, zone)) end = start;
		const series: CalendarEvent = {
			id: 'e',
			title: r.title,
			description: r.description,
			zone,
			start,
			end,
			repeat: r.repeat,
		};
		if (r.allDay) series.allDay = true;
		if (nominal) series.nominalDays = r.days;
		if (r.repeat === 'monthly' && r.byWeekday) {
			series.monthlyBy = 'weekday';
			series.ordinal = repeatChoices(start, zone).ordinals[0] ?? 1;
		}
		if (r.repeat !== 'none' && r.end === 'count') series.count = r.count;
		if (r.repeat !== 'none' && r.end === 'until') {
			const last = seriesStart(series, r.untilSteps);
			if (Number.isFinite(last)) series.until = r.allDay ? last : Math.floor(last / 1000) * 1000;
		}
		const exceptions = new Map<number, EventException>();
		if (r.repeat !== 'none')
			for (const c of r.changes) {
				const originalStart = seriesStart(series, c.index);
				if (!Number.isFinite(originalStart) || !withinSeries(series, c.index, originalStart))
					continue;
				if (c.cancelled) {
					exceptions.set(originalStart, { originalStart, cancelled: true });
					continue;
				}
				if (!unambiguous(occurrenceEnd(series, originalStart), zone)) continue;
				const e: EventException = { originalStart, cancelled: false };
				const moved = originalStart + c.shift * 60_000;
				const movedEnd = moved + (end - start);
				if (c.shift !== 0 && !r.allDay && unambiguous(moved, zone) && unambiguous(movedEnd, zone)) {
					e.start = moved;
					e.end = movedEnd;
				}
				if (c.title !== undefined && c.title !== r.title) e.title = c.title;
				if (c.description !== undefined && c.description !== r.description)
					e.description = c.description;
				exceptions.set(originalStart, e);
			}
		if (exceptions.size)
			series.exceptions = [...exceptions.values()].sort(
				(a, b) => a.originalStart - b.originalStart,
			);
		if (r.location !== undefined) series.location = r.location;
		if (r.reminder !== undefined) series.reminder = r.reminder;
		if (r.organizer) series.organizer = r.organizer;
		if (r.attendees.length)
			series.attendees = r.attendees.map((a) => ({
				name: a.name,
				email: a.email,
				...(a.response ? { response: a.response } : {}),
				...(a.optional ? { optional: true } : {}),
			}));
		return series;
	});

describe('the iCalendar round trip on any event', () => {
	it('reads back what it wrote', () => {
		fc.assert(
			fc.property(fc.array(event, { minLength: 1, maxLength: 3 }), (list) => {
				const events = list.map((e, i) => ({ ...e, id: `e${i}` }));
				const text = eventsToIcs(events, {
					prodId: '-//Example//Test//EN',
					uidDomain: 'example.com',
					now: 0,
				});
				const back = parseIcs(text, { zone: NY, uidDomain: 'example.com' });
				expect(back.unsupported).toEqual([]);
				expect(back.events).toEqual(events);
			}),
			{ numRuns: 300 },
		);
	});
});
