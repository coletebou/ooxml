import { parseIcs } from './ics-read';
import { eventsToIcs } from './ics-write';
import type { CalendarEvent } from './model';
import { occurrencesBetween } from './occurrences';
import { HOUR_MS, minuteOfDay, zonedToUtc } from './time-zone';

const NY = 'America/New_York';
const BERLIN = 'Europe/Berlin';
const ics = (...lines: string[]): string => `${lines.join('\r\n')}\r\n`;
const calendar = (...lines: string[]): string =>
	ics('BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Example//Test//EN', ...lines, 'END:VCALENDAR');
const vevent = (...lines: string[]): string[] => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];

/** A calendar the way a common calendar service exports it. */
const EXPORT = ics(
	'BEGIN:VCALENDAR',
	'PRODID:-//Example Corp//Example Calendar 70.9054//EN',
	'VERSION:2.0',
	'CALSCALE:GREGORIAN',
	'METHOD:PUBLISH',
	'X-WR-CALNAME:Team',
	'X-WR-TIMEZONE:America/New_York',
	'BEGIN:VTIMEZONE',
	'TZID:America/New_York',
	'X-LIC-LOCATION:America/New_York',
	'BEGIN:DAYLIGHT',
	'TZOFFSETFROM:-0500',
	'TZOFFSETTO:-0400',
	'TZNAME:EDT',
	'DTSTART:19700308T020000',
	'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
	'END:DAYLIGHT',
	'BEGIN:STANDARD',
	'TZOFFSETFROM:-0400',
	'TZOFFSETTO:-0500',
	'TZNAME:EST',
	'DTSTART:19701101T020000',
	'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
	'END:STANDARD',
	'END:VTIMEZONE',
	'BEGIN:VEVENT',
	'DTSTART;TZID=America/New_York:20260302T090000',
	'DTEND;TZID=America/New_York:20260302T093000',
	'RRULE:FREQ=WEEKLY;WKST=SU;UNTIL=20260406T130000Z;BYDAY=MO',
	'EXDATE;TZID=America/New_York:20260316T090000',
	'DTSTAMP:20260101T120000Z',
	'UID:7kukuqrfedlm2f9t5lbftbcgv3@example.com',
	'CREATED:20251201T100000Z',
	'DESCRIPTION:Agenda:\\n1. Status\\, blockers\\; risks\\n2. Next steps\\nNotes: ht',
	' tps://example.com/notes/weekly-sync',
	'LAST-MODIFIED:20251215T100000Z',
	'LOCATION:Room 4\\, second floor',
	'SEQUENCE:2',
	'STATUS:CONFIRMED',
	'SUMMARY:Weekly sync',
	'TRANSP:OPAQUE',
	'BEGIN:VALARM',
	'ACTION:DISPLAY',
	'DESCRIPTION:This is an event reminder',
	'TRIGGER:-P0DT0H10M0S',
	'END:VALARM',
	'END:VEVENT',
	'BEGIN:VEVENT',
	'DTSTART;VALUE=DATE:20260403',
	'DTEND;VALUE=DATE:20260407',
	'DTSTAMP:20260101T120000Z',
	'UID:2b7c0d8e@example.com',
	'SUMMARY:Spring holiday',
	'TRANSP:TRANSPARENT',
	'END:VEVENT',
	'BEGIN:VEVENT',
	'DTSTART;TZID=America/New_York:20260323T100000',
	'DTEND;TZID=America/New_York:20260323T110000',
	'DTSTAMP:20260101T120000Z',
	'UID:7kukuqrfedlm2f9t5lbftbcgv3@example.com',
	'RECURRENCE-ID;TZID=America/New_York:20260323T090000',
	'DESCRIPTION:Agenda:\\n1. Status\\, blockers\\; risks\\n2. Next steps\\nNotes: ht',
	' tps://example.com/notes/weekly-sync',
	'LOCATION:Room 4\\, second floor',
	'SEQUENCE:3',
	'SUMMARY:Weekly sync (moved)',
	'BEGIN:VALARM',
	'ACTION:DISPLAY',
	'TRIGGER:-PT10M',
	'END:VALARM',
	'END:VEVENT',
	'END:VCALENDAR',
);

describe('a calendar export', () => {
	const at = (month: number, day: number, hour = 9, minute = 0): number =>
		zonedToUtc({ year: 2026, month, day, hour, minute }, NY);
	const { events, unsupported } = parseIcs(EXPORT, { zone: NY });

	it('reads the repeating event with its zone, details, reminder and exceptions', () => {
		expect(events).toHaveLength(2);
		expect(events[0]).toEqual({
			id: '7kukuqrfedlm2f9t5lbftbcgv3@example.com',
			uid: '7kukuqrfedlm2f9t5lbftbcgv3@example.com',
			title: 'Weekly sync',
			description:
				'Agenda:\n1. Status, blockers; risks\n2. Next steps\nNotes: https://example.com/notes/weekly-sync',
			location: 'Room 4, second floor',
			zone: NY,
			start: at(3, 2),
			end: at(3, 2, 9, 30),
			repeat: 'weekly',
			until: Date.UTC(2026, 3, 6, 13),
			reminder: 10,
			exceptions: [
				{ originalStart: at(3, 16), cancelled: true },
				{
					originalStart: at(3, 23),
					cancelled: false,
					start: at(3, 23, 10),
					end: at(3, 23, 11),
					title: 'Weekly sync (moved)',
				},
			],
		});
	});

	it('repeats at 09:00 New York time across the change to daylight saving time', () => {
		const shown = occurrencesBetween(events[0]!, 0, 1e15);
		expect(shown.map((o) => o.start)).toEqual([
			at(3, 2),
			at(3, 9),
			at(3, 23, 10),
			at(3, 30),
			at(4, 6),
		]);
		expect(shown.filter((o) => !o.changed).every((o) => minuteOfDay(o.start, NY) === 540)).toBe(
			true,
		);
		expect(shown[3]!.start - shown[0]!.start).toBe(28 * 24 * HOUR_MS - HOUR_MS);
	});

	it('reads an all-day event as whole days, the end exclusive', () => {
		expect(events[1]).toEqual({
			id: '2b7c0d8e@example.com',
			uid: '2b7c0d8e@example.com',
			title: 'Spring holiday',
			description: '',
			zone: NY,
			start: zonedToUtc({ year: 2026, month: 4, day: 3 }, NY),
			end: zonedToUtc({ year: 2026, month: 4, day: 7 }, NY),
			repeat: 'none',
			allDay: true,
		});
		const [holiday] = occurrencesBetween(events[1]!, 0, 1e15);
		expect(holiday?.dates).toEqual({ start: '2026-04-03', end: '2026-04-07' });
	});

	it('lists what it did not import, once each', () => {
		expect(unsupported).toEqual([
			'X-WR-CALNAME is not imported',
			'X-WR-TIMEZONE is not imported',
			'TRANSP is not imported',
		]);
	});
});

describe('parseIcs: scheduling messages', () => {
	const event = vevent(
		'UID:abc@example.com',
		'DTSTART:20261022T140000Z',
		'DTEND:20261022T150000Z',
		'SUMMARY:Review',
	);
	it('reads no event from a reply, a counterproposal or a refresh, and says so', () => {
		for (const method of ['REPLY', 'COUNTER', 'DECLINECOUNTER', 'REFRESH']) {
			const read = parseIcs(calendar(`METHOD:${method}`, ...event));
			expect(read.events, method).toEqual([]);
			expect(read.unsupported, method).toEqual([
				`METHOD:${method} answers an invitation and holds no event to import`,
			]);
		}
		// Occurrences added to a series would replace the series they belong to.
		expect(parseIcs(calendar('METHOD:ADD', ...event))).toEqual({
			events: [],
			unsupported: [
				'METHOD:ADD adds occurrences to an event it does not hold, so nothing is imported',
			],
		});
		// Lower case is the same method (RFC 5545 values are case-insensitive).
		expect(parseIcs(calendar('METHOD:counter', ...event)).events).toEqual([]);
	});

	it('reads the events a published calendar or an invitation holds', () => {
		for (const method of ['PUBLISH', 'REQUEST'])
			expect(
				parseIcs(calendar(`METHOD:${method}`, ...event)).events.map((e) => e.title),
				method,
			).toEqual(['Review']);
		// Two calendars in one file: the reply's events alone are left out.
		const both = parseIcs(
			calendar('METHOD:REQUEST', ...event) +
				calendar(
					'METHOD:REPLY',
					...vevent('UID:other@example.com', 'DTSTART:20261023T140000Z', 'SUMMARY:Answer'),
				),
		);
		expect(both.events.map((e) => e.title)).toEqual(['Review']);
	});
});

/** An invitation the way a common mail server writes one: a display name as the TZID. */
const INVITATION = ics(
	'BEGIN:VCALENDAR',
	'METHOD:REQUEST',
	'PRODID:-//Example Mail Server//EN',
	'VERSION:2.0',
	'BEGIN:VTIMEZONE',
	'TZID:W. Europe Standard Time',
	'BEGIN:STANDARD',
	'DTSTART:16010101T030000',
	'TZOFFSETFROM:+0200',
	'TZOFFSETTO:+0100',
	'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10',
	'END:STANDARD',
	'BEGIN:DAYLIGHT',
	'DTSTART:16010101T020000',
	'TZOFFSETFROM:+0100',
	'TZOFFSETTO:+0200',
	'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3',
	'END:DAYLIGHT',
	'END:VTIMEZONE',
	'BEGIN:VEVENT',
	'ORGANIZER;CN=Ada Lovelace:mailto:ada@example.com',
	'ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Bob:mailto:bob@example.com',
	'ATTENDEE;ROLE=OPT-PARTICIPANT;PARTSTAT=TENTATIVE;CN="Doe, Jane":mailto:jane@example.com',
	'DESCRIPTION;LANGUAGE=en-US:Quarterly planning\\n',
	'UID:040000008200E00074C5B7101A82E00800000000A0B1C2D3E4F5',
	'SUMMARY;LANGUAGE=en-US:Planning',
	'DTSTART;TZID=W. Europe Standard Time:20260325T090000',
	'DTEND;TZID=W. Europe Standard Time:20260325T103000',
	'RRULE:FREQ=MONTHLY;BYDAY=-1WE',
	'CLASS:PUBLIC',
	'PRIORITY:5',
	'DTSTAMP:20260301T080000Z',
	'TRANSP:OPAQUE',
	'STATUS:CONFIRMED',
	'SEQUENCE:0',
	'LOCATION;LANGUAGE=en-US:Board room',
	'X-EXAMPLE-BUSYSTATUS:BUSY',
	'BEGIN:VALARM',
	'DESCRIPTION:REMINDER',
	'TRIGGER;RELATED=START:-PT15M',
	'ACTION:DISPLAY',
	'END:VALARM',
	'END:VEVENT',
	'END:VCALENDAR',
);

describe('an invitation in a zone named by its rules', () => {
	const { events, unsupported } = parseIcs(INVITATION);
	const event = events[0]!;

	it('converts the times with the VTIMEZONE rules and repeats in the matching zone', () => {
		expect(event.zone).toBe(BERLIN);
		expect(event.start).toBe(zonedToUtc({ year: 2026, month: 3, day: 25, hour: 9 }, BERLIN));
		expect(event.end - event.start).toBe(1.5 * HOUR_MS);
		expect(event).toMatchObject({ repeat: 'monthly', monthlyBy: 'weekday', ordinal: -1 });
		// The last Wednesday at 09:00 in Berlin, before and after the clocks change on 29 March.
		const starts = occurrencesBetween(event, 0, Date.UTC(2026, 6, 1)).map((o) => o.start);
		expect(starts).toEqual(
			[
				[3, 25],
				[4, 29],
				[5, 27],
				[6, 24],
			].map(([month, day]) =>
				zonedToUtc({ year: 2026, month: month!, day: day!, hour: 9 }, BERLIN),
			),
		);
	});

	it('reads the organizer, the attendees and their answers', () => {
		expect(event.organizer).toEqual({ name: 'Ada Lovelace', email: 'ada@example.com' });
		expect(event.attendees).toEqual([
			{ name: 'Bob', email: 'bob@example.com', response: 'needs-action' },
			{ name: 'Doe, Jane', email: 'jane@example.com', response: 'tentative', optional: true },
		]);
		expect(event).toMatchObject({
			title: 'Planning',
			description: 'Quarterly planning\n',
			location: 'Board room',
			reminder: 15,
		});
	});

	it('reports the properties it does not keep', () => {
		expect(unsupported).toEqual([
			'PRIORITY is not imported',
			'X-EXAMPLE-BUSYSTATUS is not imported',
		]);
	});

	it('gives the same instants as the platform zone, in the gap and the repeated hour too', () => {
		const zoneLines = INVITATION.split('\r\n').slice(4, 19);
		for (const [month, day, hour, minute] of [
			[1, 15, 12, 0],
			[3, 29, 1, 59],
			[3, 29, 2, 30],
			[3, 29, 3, 0],
			[10, 25, 2, 30],
			[10, 25, 3, 0],
			[12, 31, 23, 59],
		] as const) {
			const wall = `2026${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}00`;
			const text = ics(
				'BEGIN:VCALENDAR',
				...zoneLines,
				...vevent(`UID:x`, `DTSTART;TZID=W. Europe Standard Time:${wall}`),
				'END:VCALENDAR',
			);
			expect(parseIcs(text).events[0]?.start).toBe(
				zonedToUtc({ year: 2026, month, day, hour, minute }, BERLIN),
			);
		}
		// The repeated hour is its first occurrence, in the file's zone as in the platform's.
		const repeated = ics(
			'BEGIN:VCALENDAR',
			...zoneLines,
			...vevent('UID:x', 'DTSTART;TZID=W. Europe Standard Time:20261025T023000'),
			'END:VCALENDAR',
		);
		expect(parseIcs(repeated).events[0]?.start).toBe(Date.UTC(2026, 9, 25, 0, 30));
	});
});

describe('zones and times', () => {
	const start = (
		line: string,
		zone?: string,
	): { start?: number; zone?: string; unsupported: string[] } => {
		const { events, unsupported } = parseIcs(
			calendar(...vevent('UID:a', line)),
			zone ? { zone } : {},
		);
		return { ...(events[0] ? { start: events[0].start, zone: events[0].zone } : {}), unsupported };
	};

	it('reads UTC, floating and IANA times', () => {
		expect(start('DTSTART:20261015T090000Z')).toEqual({
			start: Date.UTC(2026, 9, 15, 9),
			zone: 'UTC',
			unsupported: [],
		});
		expect(start('DTSTART:20261015T090000', 'Asia/Tokyo')).toMatchObject({
			start: Date.UTC(2026, 9, 15, 0),
			zone: 'Asia/Tokyo',
		});
		expect(start('DTSTART:20261015T090000')).toMatchObject({
			start: Date.UTC(2026, 9, 15, 9),
			zone: 'UTC',
		});
		expect(start('DTSTART;TZID="Europe/Berlin":20261015T0900')).toMatchObject({
			start: Date.UTC(2026, 9, 15, 7),
			zone: BERLIN,
		});
		expect(
			start('DTSTART;TZID=/mozilla.org/20050126_1/Europe/Paris:20261015T090000'),
		).toMatchObject({
			start: Date.UTC(2026, 9, 15, 7),
			zone: 'Europe/Paris',
		});
	});

	it('reads an unknown zone without a VTIMEZONE as UTC and says so', () => {
		expect(start('DTSTART;TZID=Nowhere Standard Time:20261015T090000')).toEqual({
			start: Date.UTC(2026, 9, 15, 9),
			zone: 'UTC',
			unsupported: [
				'Time zone "Nowhere Standard Time" is unknown and the file does not describe it: its times were read as UTC',
			],
		});
	});

	it('takes a city named in the TZID when several zones share the rules', () => {
		// A parameter value with `:` or `,` is quoted; the TZID property value is not.
		const name = '(UTC+01:00) Amsterdam, Berlin, Bern, Rome';
		const text = INVITATION.replaceAll('TZID=W. Europe Standard Time', `TZID="${name}"`).replaceAll(
			'TZID:W. Europe Standard Time',
			`TZID:${name}`,
		);
		expect(parseIcs(text).events[0]?.zone).toBe('Europe/Amsterdam');
	});

	it('finds a VTIMEZONE whose TZID, a TEXT value, escapes the commas the parameter quotes', () => {
		// RFC 5545 3.8.3.1: the property is TEXT (`\,` is a comma); the parameter is a param-value.
		const named = (property: string, parameter: string): string =>
			INVITATION.replaceAll('TZID=W. Europe Standard Time', `TZID=${parameter}`).replaceAll(
				'TZID:W. Europe Standard Time',
				`TZID:${property}`,
			);
		const nine = zonedToUtc({ year: 2026, month: 3, day: 25, hour: 9 }, BERLIN);
		const escaped = parseIcs(named('Example\\, Zone', '"Example, Zone"'));
		expect(escaped.events[0]).toMatchObject({ zone: BERLIN, start: nine });
		expect(escaped.unsupported).not.toContainEqual(expect.stringContaining('Time zone'));
		// A parameter written with the same backslash as the property still finds it.
		expect(parseIcs(named('Example\\, Zone', '"Example\\, Zone"')).events[0]).toMatchObject({
			zone: BERLIN,
			start: nine,
		});
	});

	it('reads BYSETPOS in a zone rule: -1 is the last Sunday, not the first', () => {
		// Twelve hours ahead, thirteen from the last Sunday of September to the first of April.
		const zone = (daylight: string): string[] => [
			'BEGIN:VTIMEZONE',
			'TZID:Zone Twelve',
			'BEGIN:STANDARD',
			'DTSTART:19700405T030000',
			'TZOFFSETFROM:+1300',
			'TZOFFSETTO:+1200',
			'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=SU;BYSETPOS=1',
			'END:STANDARD',
			'BEGIN:DAYLIGHT',
			'DTSTART:19700927T020000',
			'TZOFFSETFROM:+1200',
			'TZOFFSETTO:+1300',
			daylight,
			'END:DAYLIGHT',
			'END:VTIMEZONE',
		];
		const read = (wall: string, daylight = 'RRULE:FREQ=YEARLY;BYMONTH=9;BYDAY=SU;BYSETPOS=-1') =>
			parseIcs(calendar(...zone(daylight), ...vevent('UID:z', `DTSTART;TZID=Zone Twelve:${wall}`)));
		// 15 September 2026 comes before the last Sunday (the 27th): still twelve hours ahead.
		const before = read('20260915T090000');
		expect(before.events[0]).toMatchObject({
			start: Date.UTC(2026, 8, 14, 21),
			zone: 'Pacific/Auckland',
		});
		expect(before.unsupported).toEqual([]);
		expect(read('20260928T090000').events[0]?.start).toBe(Date.UTC(2026, 8, 27, 20));
		// The same rule written with the ordinal in BYDAY.
		expect(read('20260915T090000', 'RRULE:FREQ=YEARLY;BYMONTH=9;BYDAY=-1SU').events[0]?.start).toBe(
			Date.UTC(2026, 8, 14, 21),
		);
		// Several positions would be several changes a year: the rule is not read, never guessed.
		const list = read('20260915T090000', 'RRULE:FREQ=YEARLY;BYMONTH=9;BYDAY=SU;BYSETPOS=1,-1');
		expect(list.events[0]?.zone).toBe('UTC');
		expect(list.unsupported).toEqual([
			'Time zone "Zone Twelve" matches no known zone: repeats in it keep UTC time',
		]);
	});

	it('reads DURATION, a missing end and an end before the start', () => {
		const read = (...lines: string[]) =>
			parseIcs(calendar(...vevent('UID:a', ...lines)), { zone: NY });
		const midnight = zonedToUtc({ year: 2026, month: 11, day: 1, hour: 0 }, NY);
		const timed = read('DTSTART;TZID=America/New_York:20261101T000000', 'DURATION:P1DT1H')
			.events[0]!;
		// A nominal day: midnight to midnight across the autumn change, then one exact hour.
		expect(timed.end).toBe(zonedToUtc({ year: 2026, month: 11, day: 2, hour: 1 }, NY));
		expect(timed.start).toBe(midnight);
		expect(read('DTSTART:20261015T090000Z').events[0]).toMatchObject({
			end: Date.UTC(2026, 9, 15, 9),
		});
		expect(read('DTSTART;VALUE=DATE:20261015').events[0]?.end).toBe(
			zonedToUtc({ year: 2026, month: 10, day: 16 }, NY),
		);
		const backwards = read('DTSTART:20261015T090000Z', 'DTEND:20261015T080000Z');
		expect(backwards.events[0]?.end).toBe(Date.UTC(2026, 9, 15, 9));
		expect(backwards.unsupported).toEqual(['An event ends before it starts; its end was left out']);
	});

	it('keeps a DURATION in days as days on the clock for every occurrence of a repeat', () => {
		// RFC 5545 3.8.5.3: DURATION is nominal for each occurrence, DTEND exact. New York goes
		// forward on 8 March 2026, so the day from the 7th at 09:00 is 23 hours long.
		const read = (duration: string) =>
			parseIcs(
				calendar(
					...vevent(
						'UID:a',
						'DTSTART;TZID=America/New_York:20260306T090000',
						duration,
						'RRULE:FREQ=DAILY;COUNT=3',
					),
				),
			);
		const at = (day: number, hour = 9): number =>
			zonedToUtc({ year: 2026, month: 3, day, hour }, NY);
		const spans = (e: CalendarEvent): number[][] =>
			occurrencesBetween(e, at(6, 0), at(10, 0)).map((o) => [o.start, o.end]);
		const days = read('DURATION:P1D');
		expect(days.unsupported).toEqual([]);
		expect(spans(days.events[0]!)).toEqual([
			[at(6), at(7)],
			[at(7), at(8)],
			[at(8), at(9)],
		]);
		// The hours after the days stay exact, and a length in hours alone is exact throughout.
		expect(spans(read('DURATION:P1DT2H').events[0]!).map(([, end]) => end)).toEqual([
			at(7, 11),
			at(8, 11),
			at(9, 11),
		]);
		expect(spans(read('DURATION:PT24H').events[0]!)).toEqual([
			[at(6), at(7)],
			[at(7), at(8, 10)],
			[at(8), at(9)],
		]);
		// Written back as a DURATION, it reads back the same.
		const text = eventsToIcs(days.events, {
			prodId: '-//Example//Test//EN',
			uidDomain: 'x',
			now: 0,
		});
		expect(text).toContain('\r\nDURATION:P1D\r\n');
		expect(text).not.toContain('DTEND');
		expect(parseIcs(text).events).toEqual(days.events);
	});

	it("reads an IANA zone by the platform's rules, and says when the file's own differ", () => {
		// New York's rules before 2007: daylight time from the first Sunday of April to the last of
		// October. It now runs from the second Sunday of March to the first of November.
		const older = [
			'BEGIN:VTIMEZONE',
			'TZID:America/New_York',
			'BEGIN:DAYLIGHT',
			'DTSTART:19870405T020000',
			'TZOFFSETFROM:-0500',
			'TZOFFSETTO:-0400',
			'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU',
			'END:DAYLIGHT',
			'BEGIN:STANDARD',
			'DTSTART:19671029T020000',
			'TZOFFSETFROM:-0400',
			'TZOFFSETTO:-0500',
			'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
			'END:STANDARD',
			'END:VTIMEZONE',
		];
		const read = (...walls: string[]) =>
			parseIcs(
				calendar(
					...older,
					...walls.flatMap((wall, i) => vevent(`UID:e${i}`, `DTSTART;TZID=${NY}:${wall}`)),
				),
			);
		// 16 March and 26 October 2026 are in daylight time now, in standard time by the older rules.
		const moved = read('20260316T090000', '20261026T090000');
		expect(moved.events.map((e) => [e.zone, e.start])).toEqual([
			[NY, Date.UTC(2026, 2, 16, 13)],
			[NY, Date.UTC(2026, 9, 26, 13)],
		]);
		expect(moved.unsupported).toEqual([
			`Time zone "${NY}" has other rules in the file: this browser's were used`,
		]);
		// In July both rules give daylight time: nothing to say.
		expect(read('20260715T090000').unsupported).toEqual([]);
	});

	it('says nothing of a zone the file describes as the platform does', () => {
		const at = (day: number, hour = 9): number =>
			zonedToUtc({ year: 2026, month: 3, day, hour }, NY);
		// Weekly across the change to daylight time, one occurrence cancelled after it.
		const review: CalendarEvent = {
			id: 'review',
			title: 'Review',
			description: '',
			zone: NY,
			start: at(2),
			end: at(2, 10),
			repeat: 'weekly',
			count: 6,
			exceptions: [{ originalStart: at(16), cancelled: true }],
		};
		const text = eventsToIcs([review], { prodId: '-//Example//Test//EN', uidDomain: 'x', now: 0 });
		expect(text).toContain(`\r\nTZID:${NY}\r\n`);
		expect(text).toContain(`\r\nEXDATE;TZID=${NY}:20260316T090000\r\n`);
		expect(parseIcs(text, { uidDomain: 'x' })).toEqual({ events: [review], unsupported: [] });
	});
});

describe('repeat rules', () => {
	const read = (rule: string, start = 'DTSTART:20261020T090000Z') =>
		parseIcs(calendar(...vevent('UID:a', 'SUMMARY:Rule', start, rule)));

	it('reads the rules a series can hold', () => {
		expect(read('RRULE:FREQ=DAILY;COUNT=5').events[0]).toMatchObject({ repeat: 'daily', count: 5 });
		expect(read('RRULE:FREQ=WEEKLY;BYDAY=TU;WKST=MO').events[0]).toMatchObject({
			repeat: 'weekly',
		});
		expect(read('RRULE:FREQ=MONTHLY;BYMONTHDAY=20').events[0]).toMatchObject({ repeat: 'monthly' });
		expect(read('RRULE:FREQ=MONTHLY;BYDAY=3TU').events[0]).toMatchObject({
			monthlyBy: 'weekday',
			ordinal: 3,
		});
		expect(read('RRULE:FREQ=MONTHLY;BYDAY=TU;BYSETPOS=3').events[0]).toMatchObject({ ordinal: 3 });
		expect(read('RRULE:FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=20').events[0]).toMatchObject({
			repeat: 'yearly',
		});
		expect(read('RRULE:FREQ=WEEKLY;UNTIL=20261124').events[0]?.until).toBe(
			Date.UTC(2026, 10, 25) - 1,
		);
		for (const rule of ['RRULE:FREQ=DAILY;COUNT=5', 'RRULE:FREQ=MONTHLY;BYDAY=3TU'])
			expect(read(rule).unsupported).toEqual([]);
	});

	it('imports the first occurrence of any other rule and says why', () => {
		for (const [rule, why] of [
			['RRULE:FREQ=WEEKLY;INTERVAL=2', 'repeats every 2 weeks'],
			['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', 'repeats on several days (BYDAY=MO,WE,FR)'],
			['RRULE:FREQ=HOURLY', 'repeats hourly'],
			['RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', 'repeats on several days (BYDAY=MO,TU,WE,TH,FR)'],
			['RRULE:FREQ=MONTHLY;BYDAY=TU', 'repeats monthly on TU'],
			['RRULE:FREQ=MONTHLY;BYDAY=2TU', 'repeats on 2TU, which is not the day it starts on'],
			['RRULE:FREQ=YEARLY;BYWEEKNO=20', 'uses BYWEEKNO'],
			['RRULE:FREQ=MONTHLY;BYMONTHDAY=15', 'repeats on day 15, which is not the date it starts on'],
		]) {
			const { events, unsupported } = read(rule!);
			expect(events[0]?.repeat).toBe('none');
			expect(unsupported).toEqual([`"Rule" ${why}; only its first occurrence was imported`]);
		}
	});

	it('reads a yearly rule on a date with no month as the monthly series it is', () => {
		// BYMONTHDAY without BYMONTH expands a yearly rule to every month (RFC 5545 3.3.10).
		const { events, unsupported } = read('RRULE:FREQ=YEARLY;BYMONTHDAY=20;COUNT=3');
		expect(events[0]).toMatchObject({ repeat: 'monthly', count: 3 });
		expect(events[0]?.monthlyBy).toBeUndefined();
		expect(occurrencesBetween(events[0]!, 0, Date.UTC(2030, 0, 1)).map((o) => o.start)).toEqual([
			Date.UTC(2026, 9, 20, 9),
			Date.UTC(2026, 10, 20, 9),
			Date.UTC(2026, 11, 20, 9),
		]);
		expect(unsupported).toEqual([]);
	});

	it('keeps a single occurrence when UNTIL is before the start', () => {
		const { events, unsupported } = read('RRULE:FREQ=DAILY;UNTIL=20261001T000000Z');
		expect(events[0]?.repeat).toBe('none');
		expect(unsupported).toEqual([]);
	});

	it('reports extra dates and a second rule', () => {
		expect(read('RDATE:20261101T090000Z').unsupported).toEqual(['RDATE is not imported']);
		expect(
			parseIcs(
				calendar(
					...vevent('UID:a', 'DTSTART:20261020T090000Z', 'RRULE:FREQ=DAILY', 'RRULE:FREQ=WEEKLY'),
				),
			).unsupported,
		).toEqual(['An event has several repeat rules; only its first occurrence was imported']);
	});
});

describe('changed and cancelled occurrences', () => {
	const series = [
		'UID:s',
		'SUMMARY:Sync',
		'DTSTART:20261020T090000Z',
		'DTEND:20261020T100000Z',
		'RRULE:FREQ=DAILY;COUNT=10',
	];
	const day = (d: number, hour = 9): number => Date.UTC(2026, 9, d, hour);

	it('cancels by STATUS on the series or on one occurrence, and by EXDATE', () => {
		const { events } = parseIcs(
			calendar(
				...vevent(...series, 'EXDATE:20261021T090000Z,20261022T090000Z'),
				...vevent(
					'UID:s',
					'RECURRENCE-ID:20261023T090000Z',
					'DTSTART:20261023T090000Z',
					'STATUS:CANCELLED',
				),
				...vevent('UID:c', 'DTSTART:20261020T090000Z', 'STATUS:CANCELLED'),
			),
		);
		expect(events[0]?.exceptions).toEqual([
			{ originalStart: day(21), cancelled: true },
			{ originalStart: day(22), cancelled: true },
			{ originalStart: day(23), cancelled: true },
		]);
		expect(events[1]).toMatchObject({ id: 'c', cancelled: true });
	});

	it('keeps only what an occurrence changes', () => {
		const { events, unsupported } = parseIcs(
			calendar(
				...vevent(...series, 'DESCRIPTION:Notes'),
				...vevent(
					'UID:s',
					'RECURRENCE-ID:20261021T090000Z',
					'SUMMARY:Sync',
					'DTSTART:20261021T090000Z',
					'DTEND:20261021T100000Z',
					'DESCRIPTION:Notes',
				),
				...vevent(
					'UID:s',
					'RECURRENCE-ID:20261022T090000Z',
					'SUMMARY:Sync',
					'DTSTART:20261022T140000Z',
					'DTEND:20261022T150000Z',
					'DESCRIPTION:Other',
					'LOCATION:Hall',
				),
			),
		);
		expect(events).toHaveLength(1);
		expect(events[0]?.exceptions).toEqual([
			{ originalStart: day(21), cancelled: false },
			{
				originalStart: day(22),
				cancelled: false,
				start: day(22, 14),
				end: day(22, 15),
				description: 'Other',
			},
		]);
		expect(unsupported).toEqual(['A changed location of a single occurrence is not imported']);
	});

	it('reports changes it cannot hold, and imports an occurrence without its series alone', () => {
		const { events, unsupported } = parseIcs(
			calendar(
				...vevent(...series),
				...vevent(
					'UID:s',
					'RECURRENCE-ID;RANGE=THISANDFUTURE:20261024T090000Z',
					'DTSTART:20261024T120000Z',
				),
				...vevent('UID:s', 'RECURRENCE-ID:20261024T093000Z', 'DTSTART:20261024T120000Z'),
				...vevent(
					'UID:lonely',
					'SUMMARY:One time',
					'RECURRENCE-ID:20261105T090000Z',
					'DTSTART:20261105T100000Z',
				),
			),
		);
		expect(events.map((e) => [e.id, e.repeat, e.exceptions?.length ?? 0])).toEqual([
			['s', 'daily', 0],
			['lonely-20261105T090000Z', 'none', 0],
		]);
		expect(unsupported).toEqual([
			'A change to "this and later occurrences" of "Sync" was not imported',
			'A changed occurrence of "Sync" is not on its series and was not imported',
			'An occurrence of a repeating event was imported on its own: the file does not hold its series',
		]);
	});

	it('gives an occurrence imported without its series an id from its UID and RECURRENCE-ID', () => {
		const one = vevent(
			'UID:lonely',
			'SUMMARY:One time',
			'RECURRENCE-ID:20261105T090000Z',
			'DTSTART:20261105T100000Z',
		);
		const two = vevent(
			'UID:lonely',
			'SUMMARY:Another time',
			'RECURRENCE-ID:20261112T090000Z',
			'DTSTART:20261112T100000Z',
		);
		const mine = vevent(
			'UID:m1@example.com',
			'RECURRENCE-ID:20261021T090000Z',
			'DTSTART:20261021T100000Z',
		);
		const read = (...events: string[][]) =>
			parseIcs(calendar(...events.flat()), { uidDomain: 'example.com' });
		const { events, unsupported } = read(one, two, mine);
		// Not the series' UID: written back, that would make each occurrence the series itself.
		expect(events.map((e) => [e.id, e.uid, e.title, e.repeat])).toEqual([
			['lonely-20261105T090000Z', undefined, 'One time', 'none'],
			['lonely-20261112T090000Z', undefined, 'Another time', 'none'],
			['m1-20261021T090000Z', undefined, '', 'none'],
		]);
		expect(unsupported).toEqual([
			'An occurrence of a repeating event was imported on its own: the file does not hold its series',
		]);
		// The same id wherever it stands, so importing it again replaces only itself.
		expect(read(two, one).events.map((e) => e.id)).toEqual([
			'lonely-20261112T090000Z',
			'lonely-20261105T090000Z',
		]);
		expect(read(two).events.map((e) => e.id)).toEqual(['lonely-20261112T090000Z']);
		// Exported and read again, each is still the event it was.
		const written = eventsToIcs(events, {
			prodId: '-//Example//Test//EN',
			uidDomain: 'example.com',
		});
		expect(parseIcs(written, { uidDomain: 'example.com' })).toEqual({ events, unsupported: [] });
	});

	it('adds changed occurrences to the series the calendar holds, never replacing it', () => {
		const held: CalendarEvent = {
			id: 'm1',
			title: 'Sync',
			description: '',
			zone: 'UTC',
			start: day(20),
			end: day(20, 10),
			repeat: 'daily',
			count: 10,
			exceptions: [{ originalStart: day(21), cancelled: true }],
		};
		const holds: Record<string, CalendarEvent> = {
			m1: held,
			m2: { ...held, id: 'm2', uid: 'm2@elsewhere.example' },
			single: { ...held, id: 'single', repeat: 'none' },
		};
		const read = (...events: string[][]) =>
			parseIcs(calendar(...events.flat()), {
				uidDomain: 'example.com',
				stored: (id) => (Object.hasOwn(holds, id) ? holds[id] : undefined),
			});
		const moved = vevent(
			'UID:m1@example.com',
			'SUMMARY:Sync',
			'RECURRENCE-ID:20261022T090000Z',
			'DTSTART:20261022T140000Z',
			'DTEND:20261022T150000Z',
		);
		// Put back where it was: the cancelled occurrence happens again.
		const back = vevent(
			'UID:m1@example.com',
			'SUMMARY:Sync',
			'RECURRENCE-ID:20261021T090000Z',
			'DTSTART:20261021T090000Z',
			'DTEND:20261021T100000Z',
		);
		const merged = read(moved, back);
		expect(merged.events).toEqual([
			{
				...held,
				exceptions: [
					{ originalStart: day(21), cancelled: false },
					{ originalStart: day(22), cancelled: false, start: day(22, 14), end: day(22, 15) },
				],
			},
		]);
		expect(merged.unsupported).toEqual([]);
		// The id of another UID, or of an event that does not repeat, is not this series.
		const alone = read(
			vevent('UID:m2', 'RECURRENCE-ID:20261022T090000Z', 'DTSTART:20261022T140000Z'),
			vevent(
				'UID:single@example.com',
				'RECURRENCE-ID:20261022T090000Z',
				'DTSTART:20261022T140000Z',
			),
		);
		expect(alone.events.map((e) => e.id)).toEqual([
			'm2-20261022T090000Z',
			'single-20261022T090000Z',
		]);
	});

	it('lets a moved occurrence replace the EXDATE of the slot it moved from', () => {
		// The way some calendars write a move: the slot excluded, and the occurrence given on its own.
		const { events, unsupported } = parseIcs(
			calendar(
				...vevent(...series, 'EXDATE:20261021T090000Z,20261022T090000Z'),
				...vevent(
					'UID:s',
					'RECURRENCE-ID:20261021T090000Z',
					'SUMMARY:Sync',
					'DTSTART:20261021T140000Z',
					'DTEND:20261021T150000Z',
				),
			),
		);
		expect(events).toHaveLength(1);
		expect(events[0]?.exceptions).toEqual([
			{ originalStart: day(21), cancelled: false, start: day(21, 14), end: day(21, 15) },
			{ originalStart: day(22), cancelled: true },
		]);
		expect(unsupported).toEqual([]);
	});

	it('imports an occurrence changed between all day and a set time as an event of its own', () => {
		const offsite = [
			'UID:d',
			'SUMMARY:Offsite',
			'DTSTART;VALUE=DATE:20261020',
			'RRULE:FREQ=DAILY;COUNT=5',
		];
		const { events, unsupported } = parseIcs(
			calendar(
				...vevent(...offsite),
				...vevent(
					'UID:d',
					'RECURRENCE-ID;VALUE=DATE:20261022',
					'SUMMARY:Offsite',
					'DTSTART:20261022T090000Z',
					'DTEND:20261022T100000Z',
				),
			),
		);
		// Its id is its series' and its RECURRENCE-ID, as for an occurrence without its series.
		expect(events.map((e) => [e.id, e.uid, e.title, e.repeat, e.allDay])).toEqual([
			['d', 'd', 'Offsite', 'daily', true],
			['d-20261022T000000Z', undefined, 'Offsite', 'none', undefined],
		]);
		expect(events[0]?.exceptions).toEqual([
			{ originalStart: Date.UTC(2026, 9, 22), cancelled: true },
		]);
		// Shown at its time, not as a day without length.
		expect(occurrencesBetween(events[1]!, Date.UTC(2026, 9, 22), Date.UTC(2026, 9, 23))).toEqual([
			expect.objectContaining({ start: day(22), end: day(22, 10) }),
		]);
		expect(occurrencesBetween(events[1]!, 0, Date.UTC(2027, 0, 1))[0]?.dates).toBeUndefined();
		expect(unsupported).toEqual([
			'An occurrence of "Offsite" changed between all day and a set time; it was imported as an event of its own',
		]);

		// The other way round: one day of a timed series made all day.
		const turned = parseIcs(
			calendar(
				...vevent(...series),
				...vevent(
					'UID:s',
					'RECURRENCE-ID:20261023T090000Z',
					'SUMMARY:Holiday',
					'DTSTART;VALUE=DATE:20261023',
				),
			),
		).events;
		expect(turned[0]?.exceptions).toEqual([{ originalStart: day(23), cancelled: true }]);
		expect(turned[1]).toMatchObject({
			id: 's-20261023T090000Z',
			title: 'Holiday',
			allDay: true,
			start: Date.UTC(2026, 9, 23),
			end: Date.UTC(2026, 9, 24),
		});
	});

	it('keeps the latest version of a changed occurrence: the highest SEQUENCE, then the last', () => {
		const change = (sequence: number | null, rid: string, ...lines: string[]): string[] =>
			vevent(
				'UID:s',
				'SUMMARY:Sync',
				...(sequence === null ? [] : [`SEQUENCE:${sequence}`]),
				`RECURRENCE-ID:${rid}`,
				...lines,
			);
		const { events, unsupported } = parseIcs(
			calendar(
				...vevent(...series),
				// Cancelled, then put back at another time by a later version.
				...change(1, '20261021T090000Z', 'DTSTART:20261021T090000Z', 'STATUS:CANCELLED'),
				...change(2, '20261021T090000Z', 'DTSTART:20261021T140000Z', 'DTEND:20261021T150000Z'),
				// The later version first in the file.
				...change(3, '20261022T090000Z', 'DTSTART:20261022T160000Z', 'DTEND:20261022T170000Z'),
				...change(1, '20261022T090000Z', 'DTSTART:20261022T120000Z', 'DTEND:20261022T130000Z'),
				// Moved, then cancelled by a later version.
				...change(4, '20261024T090000Z', 'DTSTART:20261024T090000Z', 'STATUS:CANCELLED'),
				...change(0, '20261024T090000Z', 'DTSTART:20261024T100000Z', 'DTEND:20261024T110000Z'),
				// The same SEQUENCE (none written is 0): the last in the file.
				...change(null, '20261023T090000Z', 'DTSTART:20261023T100000Z', 'DTEND:20261023T110000Z'),
				...change(0, '20261023T090000Z', 'DTSTART:20261023T110000Z', 'DTEND:20261023T120000Z'),
			),
		);
		expect(events).toHaveLength(1);
		expect(events[0]?.exceptions).toEqual([
			{ originalStart: day(21), cancelled: false, start: day(21, 14), end: day(21, 15) },
			{ originalStart: day(22), cancelled: false, start: day(22, 16), end: day(22, 17) },
			{ originalStart: day(23), cancelled: false, start: day(23, 11), end: day(23, 12) },
			{ originalStart: day(24), cancelled: true },
		]);
		expect(unsupported).toEqual([
			'"Sync" has a changed occurrence that appears more than once; the latest version was kept',
		]);
	});

	it('keeps the latest of two versions of an event', () => {
		const { events, unsupported } = parseIcs(
			calendar(
				...vevent('UID:v', 'SUMMARY:Old', 'SEQUENCE:1', 'DTSTART:20261020T090000Z'),
				...vevent('UID:v', 'SUMMARY:New', 'SEQUENCE:2', 'DTSTART:20261020T090000Z'),
				...vevent('UID:v', 'SUMMARY:Older', 'SEQUENCE:0', 'DTSTART:20261020T090000Z'),
			),
		);
		expect(events.map((e) => e.title)).toEqual(['New']);
		expect(unsupported).toEqual([
			'"New" appears more than once; the latest version was kept',
			'"Older" appears more than once; the latest version was kept',
		]);
	});
});

describe('what is not an event', () => {
	it('reports other components, alarms it cannot hold and other statuses', () => {
		const { events, unsupported } = parseIcs(
			calendar(
				'BEGIN:VTODO',
				'SUMMARY:Task',
				'END:VTODO',
				'BEGIN:VTODO',
				'END:VTODO',
				...vevent(
					'UID:a',
					'DTSTART:20261020T090000Z',
					'STATUS:TENTATIVE',
					'BEGIN:VALARM',
					'TRIGGER;VALUE=DATE-TIME:20261020T080000Z',
					'END:VALARM',
					'BEGIN:VALARM',
					'TRIGGER:-PT30M',
					'END:VALARM',
					'BEGIN:VALARM',
					'TRIGGER:-PT1H',
					'END:VALARM',
				),
			),
		);
		expect(events[0]?.reminder).toBe(30);
		expect(unsupported).toEqual([
			'STATUS:TENTATIVE is not imported',
			'Reminders at a set time, after the start or before the end are not imported',
			'Only the first reminder of an event is imported',
			'2 VTODO components not imported',
		]);
	});

	it('never throws on broken input and reports what it skipped', () => {
		const broken = parseIcs(
			'BEGIN:VCALENDAR\nthis is not a line\nBEGIN:VEVENT\nSUMMARY:No start\nEND:VEVENT\nBEGIN:VEVENT\nUID:x\nDTSTART:20261340T250000Z\nEND:VEVENT\nBEGIN:VEVENT\nUID:ok\nDTSTART:20261020T090000Z',
		);
		expect(broken.events.map((e) => e.id)).toEqual(['ok']);
		expect(broken.unsupported).toEqual([
			'1 line could not be read',
			'VCALENDAR was not closed (END:VCALENDAR is missing)',
			'VEVENT was not closed (END:VEVENT is missing)',
			'"No start" has no start that can be read and was skipped',
			'An event has no start that can be read and was skipped',
		]);
		expect(parseIcs('')).toEqual({ events: [], unsupported: [] });
		expect(parseIcs('hello')).toEqual({
			events: [],
			unsupported: ['1 line could not be read', 'The text holds no calendar (BEGIN:VCALENDAR)'],
		});
		expect(parseIcs(undefined as unknown as string)).toEqual({ events: [], unsupported: [] });
	});

	it('reads events written without a VCALENDAR and gives ids to events without a UID', () => {
		const { events } = parseIcs(
			ics(
				...vevent('DTSTART:20261020T090000Z', 'SUMMARY:a'),
				...vevent('DTSTART:20261021T090000Z', 'SUMMARY:b'),
			),
		);
		expect(events.map((e) => [e.id, e.title, e.uid])).toEqual([
			['event', 'a', undefined],
			['event-2', 'b', undefined],
		]);
	});

	it('gives back the ids of events this app wrote for the same domain', () => {
		const { events } = parseIcs(
			calendar(...vevent('UID:m1@example.com', 'DTSTART:20261020T090000Z')),
			{
				uidDomain: 'example.com',
			},
		);
		expect(events[0]).toMatchObject({ id: 'm1' });
		expect(events[0]?.uid).toBeUndefined();
	});

	it('reads floating times in UTC when the given zone is unknown', () => {
		const { events, unsupported } = parseIcs(
			calendar(...vevent('UID:a', 'DTSTART:20261020T090000')),
			{
				zone: 'Mars/Olympus',
			},
		);
		expect(events[0]).toMatchObject({ start: Date.UTC(2026, 9, 20, 9), zone: 'UTC' });
		expect(unsupported).toEqual([
			'The zone "Mars/Olympus" is unknown: floating times and dates were read in UTC',
		]);
	});
});

describe('the ids of imported events in a calendar', () => {
	const at = 'DTSTART:20261020T090000Z';
	const mine: CalendarEvent = {
		id: 'm1',
		title: 'Mine',
		description: '',
		zone: 'UTC',
		start: Date.UTC(2026, 9, 20, 9),
		end: Date.UTC(2026, 9, 20, 10),
		repeat: 'none',
	};
	const options = { prodId: '-//Example//Test//EN', uidDomain: 'example.com' };
	/** A calendar that saves each imported event by its id, as the mail client does. */
	const holding = (...held: CalendarEvent[]) => {
		const events = new Map(held.map((event) => [event.id, event]));
		const load = (text: string) => {
			const read = parseIcs(text, {
				uidDomain: 'example.com',
				taken: (id) => events.has(id),
				stored: (id) => events.get(id),
			});
			for (const event of read.events) events.set(event.id, event);
			return read.events.map((event) => [event.id, event.uid, event.title]);
		};
		return { events, load, add: (...lines: string[][]) => load(calendar(...lines.flat())) };
	};

	it('never replaces an event without a UID with one whose UID is its id', () => {
		const held = holding();
		expect(held.add(vevent(at, 'SUMMARY:First'))).toEqual([['event', undefined, 'First']]);
		expect(held.add(vevent('UID:event', at, 'SUMMARY:Unrelated'))).toEqual([
			['event-2', 'event', 'Unrelated'],
		]);
		// The same UID again is the same event again.
		expect(held.add(vevent('UID:event', at, 'SUMMARY:Unrelated, moved'))).toEqual([
			['event-2', 'event', 'Unrelated, moved'],
		]);
		expect(held.events.get('event')?.title).toBe('First');
	});

	it('tells an event this app wrote from another with the same id', () => {
		const held = holding(mine, { ...mine, id: 'x', uid: 'x', title: 'Theirs' });
		// `m1@example.com` is how this app writes `m1`; a bare `m1` is another program's event.
		expect(held.add(vevent('UID:m1', at, 'SUMMARY:Elsewhere'))).toEqual([
			['m1-2', 'm1', 'Elsewhere'],
		]);
		expect(held.add(vevent('UID:m1@example.com', at, 'SUMMARY:Mine, moved'))).toEqual([
			['m1', undefined, 'Mine, moved'],
		]);
		// Of this app's domain but at the id of another UID: it keeps its UID, so it stays itself.
		expect(held.add(vevent('UID:x@example.com', at, 'SUMMARY:Copied'))).toEqual([
			['x-2', 'x@example.com', 'Copied'],
		]);
		expect(held.add(vevent('UID:x', at, 'SUMMARY:Theirs, moved'))).toEqual([
			['x', 'x', 'Theirs, moved'],
		]);
		// Written out and read back, every event is the one it was.
		const before = [...held.events.values()];
		held.load(eventsToIcs(before, options));
		expect([...held.events.values()]).toEqual(before);
	});

	it('gives an occurrence imported on its own an id no other event holds', () => {
		const lookalike = {
			...mine,
			id: 'lonely-20261105T090000Z',
			uid: 'lonely-20261105T090000Z',
			title: 'Look-alike',
		};
		const held = holding(lookalike);
		const occurrence = vevent(
			'UID:lonely',
			'SUMMARY:One time',
			'RECURRENCE-ID:20261105T090000Z',
			'DTSTART:20261105T100000Z',
		);
		const moved = [
			['lonely-20261105T090000Z-2', 'lonely-20261105T090000Z@example.com', 'One time'],
		];
		expect(held.add(occurrence)).toEqual(moved);
		expect(held.add(occurrence)).toEqual(moved);
		expect(held.events.get(lookalike.id)).toEqual(lookalike);
		const before = [...held.events.values()];
		held.load(eventsToIcs(before, options));
		expect([...held.events.values()]).toEqual(before);
	});

	it('adds a changed occurrence to the series it holds at another id', () => {
		const held = holding({ ...mine, id: 'r' });
		expect(held.add(vevent('UID:r', 'SUMMARY:Review', at, 'RRULE:FREQ=DAILY;COUNT=5'))).toEqual([
			['r-2', 'r', 'Review'],
		]);
		const change = vevent(
			'UID:r',
			'SUMMARY:Review',
			'RECURRENCE-ID:20261021T090000Z',
			'DTSTART:20261021T140000Z',
		);
		expect(held.add(change)).toEqual([['r-2', 'r', 'Review']]);
		expect(held.events.get('r-2')?.exceptions).toEqual([
			{
				originalStart: Date.UTC(2026, 9, 21, 9),
				cancelled: false,
				start: Date.UTC(2026, 9, 21, 14),
				end: Date.UTC(2026, 9, 21, 14),
			},
		]);
		expect(held.events.get('r')).toEqual({ ...mine, id: 'r' });
	});
});

describe('the time zones of a file that holds several calendars', () => {
	it("reads each calendar's times in the zone it defines, whatever the next one names the same", () => {
		// A TZID names a VTIMEZONE of its own calendar (RFC 5545 3.6.5): two calendars of one file may
		// each define a zone by one name, and neither changes the other's times.
		const custom = (offset: string): string[] => [
			'BEGIN:VTIMEZONE',
			'TZID:Office Time',
			'BEGIN:STANDARD',
			`TZOFFSETFROM:${offset}`,
			`TZOFFSETTO:${offset}`,
			'DTSTART:19700101T000000',
			'END:STANDARD',
			'END:VTIMEZONE',
		];
		const event = (uid: string): string[] =>
			vevent(
				`UID:${uid}`,
				'DTSTAMP:20261001T000000Z',
				'DTSTART;TZID=Office Time:20261021T090000',
				'DTEND;TZID=Office Time:20261021T100000',
				`SUMMARY:${uid}`,
			);
		const file =
			calendar(...custom('+0100'), ...event('first')) +
			calendar(...custom('+0200'), ...event('second'));
		const { events } = parseIcs(file);
		expect(events.map((e) => [e.title, new Date(e.start).toISOString()])).toEqual([
			['first', '2026-10-21T08:00:00.000Z'],
			['second', '2026-10-21T07:00:00.000Z'],
		]);
	});
});
