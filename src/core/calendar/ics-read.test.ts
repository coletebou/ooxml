import { parseIcs } from './ics-read';
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
			['lonely', 'none', 0],
		]);
		expect(unsupported).toEqual([
			'A change to "this and later occurrences" of "Sync" was not imported',
			'A changed occurrence of "Sync" is not on its series and was not imported',
			'An occurrence of a repeating event was imported on its own: the file does not hold its series',
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
