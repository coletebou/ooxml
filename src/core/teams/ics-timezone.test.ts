import { meetingToIcs } from './ics';
import type { Meeting } from './meetings';
import { HOUR_MS, zonedToUtc } from './time-zone';

// The zone transitions, the VTIMEZONE block and the zoned date-time values are tested with the
// calendar area (src/core/calendar); this file pins what a meeting export makes of them.
describe('exported recurring meeting', () => {
	const NY = 'America/New_York';
	const at = (month: number, day: number, hour = 9): number =>
		zonedToUtc({ year: 2026, month, day, hour }, NY);
	const base: Meeting = {
		id: 'm1',
		title: 'Weekly, sync; "team"',
		description: 'Line one\nLine two',
		organizerId: 'ada',
		organizerName: 'Ada',
		zone: NY,
		start: at(3, 2),
		end: at(3, 2) + HOUR_MS,
		repeat: 'weekly',
		attendees: [],
		createdAt: 0,
		cancelled: false,
	};
	const lines = (m: Meeting): string[] =>
		meetingToIcs(m, { now: Date.UTC(2026, 0, 1) })
			.replace(/\r\n /gu, '')
			.split('\r\n');

	it('puts the VTIMEZONE before the event and keeps 09:00 local', () => {
		const out = lines(base);
		expect(out.indexOf('BEGIN:VTIMEZONE')).toBeGreaterThan(out.indexOf('BEGIN:VCALENDAR'));
		expect(out.indexOf('END:VTIMEZONE')).toBeLessThan(out.indexOf('BEGIN:VEVENT'));
		expect(out).toContain('DTSTART;TZID=America/New_York:20260302T090000');
		expect(out).toContain('DTEND;TZID=America/New_York:20260302T100000');
		expect(out).toContain('RRULE:FREQ=WEEKLY');
		expect(out).toContain('SUMMARY:Weekly\\, sync\\; "team"');
		expect(out).toContain('DESCRIPTION:Line one\\nLine two\\n\\nOrganizer: Ada');
		expect(out.some((l) => l.startsWith('DTSTART') && l.endsWith('Z'))).toBe(false);
	});

	it('writes COUNT or UNTIL (in UTC) and EXDATE in the zone', () => {
		expect(lines({ ...base, count: 6 })).toContain('RRULE:FREQ=WEEKLY;COUNT=6');
		const until = lines({ ...base, until: Date.UTC(2026, 5, 1, 3, 59, 59) });
		expect(until).toContain('RRULE:FREQ=WEEKLY;UNTIL=20260601T035959Z');
		const ex = lines({
			...base,
			exceptions: [
				{ originalStart: at(3, 9), cancelled: true },
				{ originalStart: at(3, 16), cancelled: true },
			],
		});
		expect(ex).toContain('EXDATE;TZID=America/New_York:20260309T090000,20260316T090000');
	});

	it('writes a changed occurrence as an overriding event with RECURRENCE-ID', () => {
		const out = lines({
			...base,
			exceptions: [
				{
					originalStart: at(3, 9),
					cancelled: false,
					start: at(3, 9, 14),
					end: at(3, 9, 15),
					title: 'Moved',
				},
			],
		});
		expect(out.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2);
		expect(out.filter((l) => l === 'UID:m1@openteams')).toHaveLength(2);
		const second = out.slice(out.lastIndexOf('BEGIN:VEVENT'));
		expect(second).toContain('RECURRENCE-ID;TZID=America/New_York:20260309T090000');
		expect(second).toContain('DTSTART;TZID=America/New_York:20260309T140000');
		expect(second).toContain('SUMMARY:Moved');
		expect(second.some((l) => l.startsWith('RRULE'))).toBe(false);
		expect(out.filter((l) => l.startsWith('EXDATE'))).toEqual([]);
	});

	it('uses plain UTC times and no VTIMEZONE for a UTC organizer', () => {
		const out = lines({
			...base,
			zone: 'UTC',
			exceptions: [{ originalStart: base.start, cancelled: true }],
		});
		expect(out).toContain('DTSTART:20260302T140000Z');
		expect(out).not.toContain('BEGIN:VTIMEZONE');
		expect(out).toContain('EXDATE:20260302T140000Z');
	});

	it('folds every line to 75 octets and ends each with CRLF', () => {
		const title = 'Ünïcödé '.repeat(40);
		const long = meetingToIcs({ ...base, title, description: 'é'.repeat(300) });
		const raw = long.split('\r\n');
		expect(raw.at(-1)).toBe('');
		const enc = new TextEncoder();
		for (const l of raw) expect(enc.encode(l).length).toBeLessThanOrEqual(75);
		expect(long).not.toMatch(/[^\r]\n/u);
		expect(long.replace(/\r\n /gu, '')).toContain(`SUMMARY:${title}`);
	});
});
