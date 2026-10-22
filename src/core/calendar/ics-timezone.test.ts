import { readComponents } from './ics-lines';
import { fileZoneOffset, readFileZone } from './ics-read-zone';
import { icsOffset, vtimezoneLines, zoneTransitions } from './ics-timezone';
import { HOUR_MS, offsetMinutes } from './time-zone';

describe('zone transitions', () => {
	it('finds the two United States changes of 2026 to the minute', () => {
		expect(zoneTransitions('America/New_York', 2026)).toEqual([
			{ at: Date.UTC(2026, 2, 8, 7), from: -300, to: -240 },
			{ at: Date.UTC(2026, 10, 1, 6), from: -240, to: -300 },
		]);
	});

	it('finds none in a zone without daylight saving', () => {
		expect(zoneTransitions('Asia/Kolkata', 2026)).toEqual([]);
		expect(zoneTransitions('UTC', 2026)).toEqual([]);
	});

	it('formats offsets with half hours and negative values', () => {
		expect(icsOffset(330)).toBe('+0530');
		expect(icsOffset(-210)).toBe('-0330');
		expect(icsOffset(0)).toBe('+0000');
	});

	it('matches the platform offsets on both sides of a change', () => {
		for (const c of zoneTransitions('Europe/Berlin', 2027)) {
			expect(offsetMinutes(c.at - HOUR_MS, 'Europe/Berlin')).toBe(c.from);
			expect(offsetMinutes(c.at, 'Europe/Berlin')).toBe(c.to);
		}
	});
});

describe('VTIMEZONE', () => {
	it('writes yearly rules for the United States', () => {
		const lines = vtimezoneLines('America/New_York', 2026);
		expect(lines[0]).toBe('BEGIN:VTIMEZONE');
		expect(lines).toContain('TZID:America/New_York');
		expect(lines).toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU');
		expect(lines).toContain('RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU');
		expect(lines).toContain('DTSTART:20250309T020000');
		expect(lines).toContain('DTSTART:20251102T020000');
		expect(lines).toContain('TZOFFSETFROM:-0500');
		expect(lines).toContain('TZOFFSETTO:-0400');
		expect(lines.at(-1)).toBe('END:VTIMEZONE');
	});

	it('uses the last Sunday for the European rule', () => {
		const lines = vtimezoneLines('Europe/Berlin', 2026);
		expect(lines).toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU');
		expect(lines).toContain('RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU');
		expect(lines).toContain('DTSTART:20250330T020000');
		expect(lines).toContain('DTSTART:20251026T030000');
		expect(lines).toContain('TZOFFSETTO:+0200');
	});

	it('orders the southern hemisphere by date', () => {
		const lines = vtimezoneLines('Australia/Sydney', 2026);
		expect(lines).toContain('RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU');
		expect(lines).toContain('RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU');
		expect(lines).toContain('TZOFFSETTO:+1100');
	});

	it('writes one fixed offset where the clocks never change', () => {
		const lines = vtimezoneLines('Asia/Kolkata', 2026);
		expect(lines).toContain('TZOFFSETFROM:+0530');
		expect(lines).toContain('TZOFFSETTO:+0530');
		expect(lines.some((l) => l.startsWith('RRULE'))).toBe(false);
		expect(lines.filter((l) => l.startsWith('BEGIN:'))).toEqual([
			'BEGIN:VTIMEZONE',
			'BEGIN:STANDARD',
		]);
	});

	it('lists the changes one by one where the rules stop repeating', () => {
		// Brazil gave up daylight saving after February 2019.
		const lines = vtimezoneLines('America/Sao_Paulo', 2019);
		expect(lines.some((l) => l.startsWith('RRULE'))).toBe(false);
		expect(lines).toContain('BEGIN:DAYLIGHT');
		expect(lines).toContain('TZOFFSETTO:-0300');
	});

	it('covers the years up to the last one asked for, and the rules a zone keeps from then on', () => {
		const offsetIn = (lines: string[], instant: number): number => {
			const zone = readFileZone(readComponents(lines.join('\r\n')).components[0]!);
			return fileZoneOffset(zone!, instant);
		};
		const july2026 = Date.UTC(2026, 6, 15, 12);
		// New York changed its rules in 2007: from 2005 alone the block lists ten years of changes
		// and then keeps standard time, so it is asked for the years up to 2026.
		const alone = vtimezoneLines('America/New_York', 2005);
		expect(alone.some((l) => l.startsWith('RRULE'))).toBe(false);
		const lines = vtimezoneLines('America/New_York', 2005, 2026);
		expect(offsetIn(lines, july2026)).toBe(-240);
		// The changes before 2007 one by one, then the two yearly rules from their first year.
		expect(lines).toContain('DTSTART:20060402T020000');
		expect(lines).toContain('DTSTART:20070311T020000');
		expect(lines).toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU');
		expect(lines).toContain('RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU');
		expect(lines).not.toContain('DTSTART:20080309T020000');
		for (const t of [
			Date.UTC(2004, 6, 1),
			Date.UTC(2005, 0, 10),
			Date.UTC(2006, 9, 30),
			Date.UTC(2007, 2, 12),
			july2026,
			Date.UTC(2040, 10, 3),
		])
			expect(offsetIn(lines, t), new Date(t).toISOString()).toBe(
				offsetMinutes(t, 'America/New_York'),
			);
		// Where the whole span keeps one pair of rules, the block is what it was for its first year.
		expect(vtimezoneLines('Europe/Berlin', 2026, 2040)).toEqual(
			vtimezoneLines('Europe/Berlin', 2026),
		);
	});

	it('has balanced BEGIN and END lines', () => {
		for (const zone of ['America/New_York', 'Europe/London', 'Asia/Tokyo', 'America/Sao_Paulo']) {
			const open: string[] = [];
			for (const l of vtimezoneLines(zone, 2026)) {
				if (l.startsWith('BEGIN:')) open.push(l.slice(6));
				else if (l.startsWith('END:')) expect(open.pop()).toBe(l.slice(4));
			}
			expect(open).toEqual([]);
		}
	});

	it('reads a change on a weekday counted from the end of its month, not only the last', () => {
		// Eight hours ahead, nine from the second-to-last Sunday of October (the 18th in 2026) to the
		// first Sunday of April.
		const zone = (byDay: string) =>
			readFileZone(
				readComponents(
					[
						'BEGIN:VTIMEZONE',
						'TZID:Zone Eight',
						'BEGIN:STANDARD',
						'DTSTART:19700405T030000',
						'TZOFFSETFROM:+0900',
						'TZOFFSETTO:+0800',
						'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU',
						'END:STANDARD',
						'BEGIN:DAYLIGHT',
						'DTSTART:19701018T020000',
						'TZOFFSETFROM:+0800',
						'TZOFFSETTO:+0900',
						`RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=${byDay}`,
						'END:DAYLIGHT',
						'END:VTIMEZONE',
					].join('\r\n'),
				).components[0]!,
			);
		const second = zone('-2SU')!;
		expect(fileZoneOffset(second, Date.UTC(2026, 9, 1, 12))).toBe(480);
		expect(fileZoneOffset(second, Date.UTC(2026, 9, 17, 12))).toBe(480);
		expect(fileZoneOffset(second, Date.UTC(2026, 9, 18, 12))).toBe(540);
		// The fourth from the end of October 2026 is its first Sunday, the 4th.
		const fourth = zone('-4SU')!;
		expect(fileZoneOffset(fourth, Date.UTC(2026, 9, 3, 12))).toBe(480);
		expect(fileZoneOffset(fourth, Date.UTC(2026, 9, 4, 12))).toBe(540);
		// One counted back further than any month has weekdays is not read, never guessed.
		expect(fileZoneOffset(zone('-5SU')!, Date.UTC(2026, 9, 25, 12))).toBe(480);
	});

	it('keeps the offset of the last change after the rules stop, not of the latest onset', () => {
		// Ten hours ahead, eleven from the first Sunday of October to the first Sunday of April, both
		// rules ending: the last change is a STANDARD one, though DAYLIGHT starts later in 2000.
		const zone = (standardEnd: string, daylightEnd: string) =>
			readFileZone(
				readComponents(
					[
						'BEGIN:VTIMEZONE',
						'TZID:Zone Ten',
						'BEGIN:STANDARD',
						'DTSTART:20000402T030000',
						'TZOFFSETFROM:+1100',
						'TZOFFSETTO:+1000',
						`RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU${standardEnd}`,
						'END:STANDARD',
						'BEGIN:DAYLIGHT',
						'DTSTART:20001001T020000',
						'TZOFFSETFROM:+1000',
						'TZOFFSETTO:+1100',
						`RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU${daylightEnd}`,
						'END:DAYLIGHT',
						'END:VTIMEZONE',
					].join('\r\n'),
				).components[0]!,
			)!;
		// The last changes: 5 April 2020 (03:00 there is 16:00 UTC the day before) and 6 October 2019.
		const until = zone(';UNTIL=20200404T160000Z', ';UNTIL=20191005T160000Z');
		expect(fileZoneOffset(until, Date.UTC(2010, 0, 15, 12))).toBe(660);
		expect(fileZoneOffset(until, Date.UTC(2019, 11, 15, 12))).toBe(660);
		expect(fileZoneOffset(until, Date.UTC(2022, 0, 15, 12))).toBe(600);
		expect(fileZoneOffset(until, Date.UTC(2026, 0, 15, 12))).toBe(600);
		// Counted instead: twenty changes back each April (2000 to 2019), nineteen on (2000 to 2018).
		const count = zone(';COUNT=20', ';COUNT=19');
		expect(fileZoneOffset(count, Date.UTC(2019, 0, 15, 12))).toBe(660);
		expect(fileZoneOffset(count, Date.UTC(2026, 0, 15, 12))).toBe(600);
		// A rule still running when the other stops keeps changing the clocks.
		const open = zone(';UNTIL=20200404T160000Z', '');
		expect(fileZoneOffset(open, Date.UTC(2026, 0, 15, 12))).toBe(660);
		expect(fileZoneOffset(open, Date.UTC(2026, 6, 15, 12))).toBe(660);
	});
});
