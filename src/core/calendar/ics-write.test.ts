import {
	eventsToIcs,
	icsAlarm,
	icsDate,
	icsDateTime,
	icsDuration,
	icsEscape,
	icsFileName,
	icsFold,
	icsLocal,
	icsUtc,
} from './ics-write';
import type { CalendarEvent } from './model';
import { HOUR_MS, zonedToUtc } from './time-zone';

const NY = 'America/New_York';
const at = (month: number, day: number, hour = 9, zone = NY): number =>
	zonedToUtc({ year: 2026, month, day, hour }, zone);
const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
	id: 'e1',
	title: 'Review',
	description: '',
	zone: NY,
	start: at(10, 15),
	end: at(10, 15) + HOUR_MS,
	repeat: 'none',
	...over,
});
const OPTIONS = {
	prodId: '-//Example//Calendar//EN',
	uidDomain: 'example.com',
	now: Date.UTC(2026, 0, 1),
};
const lines = (events: CalendarEvent[], options = {}): string[] =>
	eventsToIcs(events, { ...OPTIONS, ...options })
		.replace(/\r\n[ \t]/gu, '')
		.split('\r\n');
/** The lines of the `n`-th VEVENT. */
const vevent = (out: string[], n = 0): string[] => {
	const starts = out.flatMap((l, i) => (l === 'BEGIN:VEVENT' ? [i] : []));
	const from = starts[n] ?? out.length;
	return out.slice(from, out.indexOf('END:VEVENT', from) + 1);
};

describe('ics values', () => {
	it('escapes, folds and writes UTC times', () => {
		expect(icsUtc(Date.UTC(2026, 9, 15, 14, 5, 9))).toBe('20261015T140509Z');
		expect(icsEscape('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
		const folded = icsFold(`SUMMARY:${'x'.repeat(200)}`);
		expect(folded.length).toBeGreaterThan(2);
		expect(folded.every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
		expect(folded.map((l, i) => (i ? l.slice(1) : l)).join('')).toBe(`SUMMARY:${'x'.repeat(200)}`);
	});

	it('writes wall time in the zone, or UTC for a UTC series', () => {
		const ms = zonedToUtc({ year: 2026, month: 10, day: 15, hour: 9 }, 'Europe/Berlin');
		expect(icsLocal(ms, 'Europe/Berlin')).toBe('20261015T090000');
		expect(icsDateTime('DTSTART', ms, 'Europe/Berlin')).toBe(
			'DTSTART;TZID=Europe/Berlin:20261015T090000',
		);
		expect(icsDateTime('DTSTART', ms, 'UTC')).toBe('DTSTART:20261015T070000Z');
		expect(icsDate(ms, 'Asia/Tokyo')).toBe('20261015');
		expect(icsDate(at(10, 15, 23), 'Asia/Tokyo')).toBe('20261016');
	});

	it('writes durations and alarms', () => {
		expect(icsDuration(5 * 60_000)).toBe('PT5M');
		expect(icsDuration(-15 * 60_000)).toBe('-PT15M');
		expect(icsDuration(26 * HOUR_MS)).toBe('P1DT2H');
		expect(icsDuration(7 * 24 * HOUR_MS)).toBe('P7D');
		expect(icsDuration(90_500)).toBe('PT1M31S');
		expect(icsDuration(0)).toBe('PT0S');
		expect(icsAlarm('Stand-up, daily', 5)).toEqual([
			'BEGIN:VALARM',
			'ACTION:DISPLAY',
			'DESCRIPTION:Stand-up\\, daily',
			'TRIGGER:-PT5M',
			'END:VALARM',
		]);
		expect(icsFileName({ title: 'Q4 / plan: draft' })).toBe('Q4-plan-draft.ics');
		expect(icsFileName({ title: '' })).toBe('event.ics');
	});
});

describe('eventsToIcs', () => {
	it('writes one calendar with an event for each, folded, with CRLF endings', () => {
		const text = eventsToIcs(
			[event({ title: 'Ünïcödé '.repeat(30) }), event({ id: 'e2', zone: 'UTC' })],
			OPTIONS,
		);
		expect(text.endsWith('\r\n')).toBe(true);
		expect(text).not.toMatch(/[^\r]\n/u);
		const raw = text.split('\r\n');
		for (const l of raw) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
		const out = lines([event(), event({ id: 'e2', zone: 'UTC' })]);
		expect(out.slice(0, 5)).toEqual([
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//Example//Calendar//EN',
			'CALSCALE:GREGORIAN',
			'METHOD:PUBLISH',
		]);
		expect(out.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2);
		expect(out).toContain('UID:e1@example.com');
		expect(out).toContain('DTSTAMP:20260101T000000Z');
		expect(out).toContain('DTSTART;TZID=America/New_York:20261015T090000');
		expect(out).toContain('DTSTART:20261015T130000Z');
		expect(out.at(-2)).toBe('END:VCALENDAR');
		expect(lines([event()], { method: 'request' })).toContain('METHOD:REQUEST');
		expect(lines([event()], { method: 'NOT A METHOD' })).toContain('METHOD:PUBLISH');
	});

	it('writes one VTIMEZONE per zone a timed event uses, none for UTC or dates', () => {
		const out = lines([
			event(),
			event({ id: 'e2', zone: 'Europe/Berlin' }),
			event({ id: 'e3', zone: NY }),
			event({ id: 'e4', zone: 'UTC' }),
			event({
				id: 'e5',
				zone: 'Asia/Tokyo',
				allDay: true,
				start: at(10, 20, 0, 'Asia/Tokyo'),
				end: at(10, 21, 0, 'Asia/Tokyo'),
			}),
		]);
		expect(out.filter((l) => l.startsWith('TZID:'))).toEqual([
			'TZID:America/New_York',
			'TZID:Europe/Berlin',
		]);
		expect(out.indexOf('END:VTIMEZONE')).toBeLessThan(out.indexOf('BEGIN:VEVENT'));
		expect(lines([event({ zone: 'UTC' })])).not.toContain('BEGIN:VTIMEZONE');
	});

	it('writes an all-day event as dates, its end the day after the last', () => {
		const tokyo = 'Asia/Tokyo';
		const out = vevent(
			lines([
				event({
					zone: tokyo,
					allDay: true,
					start: at(10, 15, 0, tokyo),
					end: at(10, 17, 0, tokyo),
					repeat: 'yearly',
					until: at(10, 15, 0, tokyo) + 2 * 365 * 24 * HOUR_MS,
					exceptions: [
						{
							originalStart: zonedToUtc({ year: 2027, month: 10, day: 15 }, tokyo),
							cancelled: true,
						},
					],
				}),
			]),
		);
		expect(out).toContain('DTSTART;VALUE=DATE:20261015');
		expect(out).toContain('DTEND;VALUE=DATE:20261017');
		expect(out).toContain('RRULE:FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=15;UNTIL=20281014');
		expect(out).toContain('EXDATE;VALUE=DATE:20271015');
	});

	it('writes the details, the place, a reminder and the status', () => {
		const out = vevent(
			lines([
				event({
					title: 'Plan; review, sign-off',
					description: 'Line one\nLine two',
					location: 'Room 4, floor 2',
					reminder: 15,
					cancelled: true,
				}),
			]),
		);
		expect(out).toContain('SUMMARY:Plan\\; review\\, sign-off');
		expect(out).toContain('DESCRIPTION:Line one\\nLine two');
		expect(out).toContain('LOCATION:Room 4\\, floor 2');
		expect(out).toContain('STATUS:CANCELLED');
		expect(out.slice(out.indexOf('BEGIN:VALARM'), out.indexOf('END:VALARM') + 1)).toEqual(
			icsAlarm('Plan; review, sign-off', 15),
		);
		const plain = vevent(lines([event()]));
		expect(plain.some((l) => /^(DESCRIPTION|LOCATION|BEGIN:VALARM)/u.test(l))).toBe(false);
		expect(plain).toContain('STATUS:CONFIRMED');
	});

	it('writes the organizer and attendees with an address, quoting names that need it', () => {
		const out = vevent(
			lines([
				event({
					organizer: { name: 'Ada Lovelace', email: 'ada@example.com' },
					attendees: [
						{ name: 'Doe, Jane', email: 'jane@example.com', response: 'accepted' },
						{ name: 'Bob "the builder"', email: 'bob@example.com', optional: true },
						{ name: 'No address' },
					],
				}),
			]),
		);
		expect(out).toContain('ORGANIZER;CN=Ada Lovelace:mailto:ada@example.com');
		expect(out).toContain('ATTENDEE;CN="Doe, Jane";PARTSTAT=ACCEPTED:mailto:jane@example.com');
		expect(out).toContain(
			"ATTENDEE;CN=Bob ^'the builder^';ROLE=OPT-PARTICIPANT:mailto:bob@example.com",
		);
		expect(out.filter((l) => l.startsWith('ATTENDEE'))).toHaveLength(2);
		const invite = vevent(
			lines([event()], {
				organizer: { name: 'Ada', email: 'ada@example.com' },
				attendees: [{ name: 'Bob', email: 'bob@example.com' }],
			}),
		);
		expect(invite).toContain('ORGANIZER;CN=Ada:mailto:ada@example.com');
		expect(invite).toContain('ATTENDEE;CN=Bob:mailto:bob@example.com');
	});

	it('writes a repeat with its cancelled and changed occurrences', () => {
		const out = lines([
			event({
				repeat: 'weekly',
				count: 6,
				location: 'Room 4',
				exceptions: [
					{ originalStart: at(10, 22), cancelled: true },
					{
						originalStart: at(10, 29),
						cancelled: false,
						start: at(10, 29, 14),
						end: at(10, 29, 15),
						title: 'Moved',
					},
					{ originalStart: at(11, 5), cancelled: false, description: 'Bring notes' },
				],
			}),
		]);
		const master = vevent(out);
		expect(master).toContain('RRULE:FREQ=WEEKLY;COUNT=6');
		expect(master).toContain('EXDATE;TZID=America/New_York:20261022T090000');
		const moved = vevent(out, 1);
		expect(moved).toContain('UID:e1@example.com');
		expect(moved).toContain('RECURRENCE-ID;TZID=America/New_York:20261029T090000');
		expect(moved).toContain('DTSTART;TZID=America/New_York:20261029T140000');
		expect(moved).toContain('SUMMARY:Moved');
		expect(moved).toContain('LOCATION:Room 4');
		expect(moved.some((l) => l.startsWith('RRULE'))).toBe(false);
		// 1 November is the autumn change: the unchanged length is kept.
		const noted = vevent(out, 2);
		expect(noted).toContain('DTSTART;TZID=America/New_York:20261105T090000');
		expect(noted).toContain('DTEND;TZID=America/New_York:20261105T100000');
		expect(noted).toContain('SUMMARY:Review');
		expect(noted).toContain('DESCRIPTION:Bring notes');
	});

	it('leaves DTEND out where the end is not after the start, which RFC 5545 forbids', () => {
		const hasEnd = (lines: string[]): boolean => lines.some((l) => l.startsWith('DTEND'));
		// A timed event without length ends where it starts: no DTEND says so (RFC 5545 3.6.1).
		const out = lines([
			event({
				end: at(10, 15),
				repeat: 'weekly',
				count: 4,
				exceptions: [
					{ originalStart: at(10, 22), cancelled: false, title: 'Same time' },
					{
						originalStart: at(10, 29),
						cancelled: false,
						start: at(10, 29, 14),
						end: at(10, 29, 14),
					},
					{ originalStart: at(11, 5), cancelled: false, start: at(11, 5, 14), end: at(11, 5, 15) },
				],
			}),
		]);
		expect([0, 1, 2].map((n) => hasEnd(vevent(out, n)))).toEqual([false, false, false]);
		expect(vevent(out, 3)).toContain('DTEND;TZID=America/New_York:20261105T150000');
		expect(hasEnd(vevent(lines([event()])))).toBe(true);
		// An all-day end on its start's date: no DTEND is the one day such an event lasts.
		const day = vevent(lines([event({ allDay: true, start: at(10, 15, 0), end: at(10, 15, 12) })]));
		expect(day).toContain('DTSTART;VALUE=DATE:20261015');
		expect(hasEnd(day)).toBe(false);
	});

	it('keeps an imported UID and writes an unknown zone as UTC', () => {
		expect(lines([event({ uid: 'abc-123@other.example' })])).toContain('UID:abc-123@other.example');
		const out = lines([event({ zone: 'Mars/Olympus' })]);
		expect(out).toContain(`DTSTART:${icsUtc(at(10, 15))}`);
		expect(out).not.toContain('BEGIN:VTIMEZONE');
	});
});
