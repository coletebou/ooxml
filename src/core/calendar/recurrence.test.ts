import type { CalendarEvent } from './model';
import { occurrenceAt, occurrencesBetween } from './occurrences';
import { seriesIndexOf } from './recurrence';
import { DAY_MS, HOUR_MS, minuteOfDay, zonedToUtc } from './time-zone';

const NY = 'America/New_York';
const at = (month: number, day: number, hour = 9, zone = NY): number =>
	zonedToUtc({ year: 2026, month, day, hour }, zone);
const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
	id: 'm1',
	title: 'Stand-up',
	description: '',
	zone: NY,
	start: at(3, 2),
	end: at(3, 2, 9) + HOUR_MS / 2,
	repeat: 'daily',
	...over,
});
const starts = (e: CalendarEvent, from: number, to: number): number[] =>
	occurrencesBetween(e, from, to).map((o) => o.start);

describe('recurrence end', () => {
	it('stops a daily series after N occurrences', () => {
		const m = event({ count: 3 });
		expect(starts(m, 0, 1e15)).toEqual([at(3, 2), at(3, 3), at(3, 4)]);
		expect(seriesIndexOf(m, at(3, 5))).toBeNull();
		expect(seriesIndexOf(m, at(3, 4))).toBe(2);
	});

	it('stops a weekly series on a date, keeping an occurrence that starts on it', () => {
		const m = event({ repeat: 'weekly', until: at(3, 16, 9) });
		expect(starts(m, 0, 1e15)).toEqual([at(3, 2), at(3, 9), at(3, 16)]);
		const before = event({ repeat: 'weekly', until: at(3, 16, 9) - 1 });
		expect(starts(before, 0, 1e15)).toEqual([at(3, 2), at(3, 9)]);
	});

	it('counts occurrences, not days, across the spring-forward change', () => {
		const m = event({ count: 10 });
		const all = occurrencesBetween(m, 0, 1e15);
		expect(all).toHaveLength(10);
		for (const o of all) expect(minuteOfDay(o.start, NY)).toBe(9 * 60);
		// 8 March 2026 is 23 hours long in New York.
		expect(all[6]!.start - all[5]!.start).toBe(DAY_MS - HOUR_MS);
	});

	it('handles a count of one and an end before the first occurrence', () => {
		expect(starts(event({ count: 1 }), 0, 1e15)).toEqual([at(3, 2)]);
		expect(starts(event({ until: at(3, 1) }), 0, 1e15)).toEqual([]);
	});

	it('ignores an end on an event that does not repeat', () => {
		expect(starts(event({ repeat: 'none', count: 2 }), 0, 1e15)).toEqual([at(3, 2)]);
	});

	it('keeps the wall time across the autumn change for a weekly series', () => {
		const m = event({ repeat: 'weekly', start: at(10, 26), end: at(10, 26) + HOUR_MS, count: 3 });
		const all = occurrencesBetween(m, 0, 1e15);
		expect(all.map((o) => minuteOfDay(o.start, NY))).toEqual([540, 540, 540]);
		// the clocks go back on 1 November 2026, after the first occurrence.
		expect(all[1]!.start - all[0]!.start).toBe(7 * DAY_MS + HOUR_MS);
		expect(all[2]!.start - all[1]!.start).toBe(7 * DAY_MS);
	});
});

describe('occurrence exceptions', () => {
	const cancelled = (originalStart: number) => ({ originalStart, cancelled: true });

	it('skips a cancelled occurrence and keeps the rest', () => {
		const m = event({ count: 4, exceptions: [cancelled(at(3, 3))] });
		expect(starts(m, 0, 1e15)).toEqual([at(3, 2), at(3, 4), at(3, 5)]);
	});

	it('applies a changed time, title and details to one occurrence', () => {
		const m = event({
			exceptions: [
				{
					originalStart: at(3, 3),
					cancelled: false,
					start: at(3, 3, 14),
					end: at(3, 3, 15),
					title: 'Moved',
					description: 'New room',
				},
			],
		});
		const day = occurrencesBetween(m, at(3, 3, 0), at(3, 4, 0));
		expect(day).toHaveLength(1);
		expect(day[0]).toMatchObject({
			start: at(3, 3, 14),
			end: at(3, 3, 15),
			title: 'Moved',
			description: 'New room',
			recurrenceId: at(3, 3),
			changed: true,
			index: 1,
		});
		expect(occurrenceAt(m, at(3, 3, 14))?.key).toBe(`m1@${at(3, 3, 14)}`);
		// The original slot is gone, the neighbours are untouched.
		expect(occurrenceAt(m, at(3, 3))).toBeNull();
		expect(occurrenceAt(m, at(3, 4))).toMatchObject({ index: 2 });
		expect(occurrenceAt(m, at(3, 4))?.title).toBeUndefined();
	});

	it('shows an occurrence moved to another day only on that day', () => {
		const m = event({
			exceptions: [
				{ originalStart: at(3, 3), cancelled: false, start: at(3, 10, 12), end: at(3, 10, 13) },
			],
		});
		expect(starts(m, at(3, 3, 0), at(3, 4, 0))).toEqual([]);
		expect(starts(m, at(3, 10, 0), at(3, 11, 0))).toEqual([at(3, 10, 9), at(3, 10, 12)]);
	});

	it('keeps a changed occurrence that ends the series', () => {
		const m = event({
			count: 2,
			exceptions: [{ originalStart: at(3, 3), cancelled: false, title: 'Last' }],
		});
		expect(occurrencesBetween(m, 0, 1e15).map((o) => o.title)).toEqual([undefined, 'Last']);
	});

	it('drops an exception whose original start is not in the series', () => {
		const m = event({
			count: 2,
			exceptions: [{ originalStart: at(3, 20), cancelled: false, title: 'Ghost' }],
		});
		expect(starts(m, 0, 1e15)).toEqual([at(3, 2), at(3, 3)]);
	});
});
