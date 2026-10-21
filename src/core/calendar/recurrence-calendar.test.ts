import type { CalendarEvent } from './model';
import { occurrenceAt, occurrencesBetween } from './occurrences';
import { seriesIndexOf } from './recurrence';
import { dayMatchesOrdinal, nthWeekdayOfMonth, ordinalOfDay } from './recurrence-calendar';
import { HOUR_MS, minuteOfDay, zonedParts, zonedToUtc } from './time-zone';

const NY = 'America/New_York';
const at = (year: number, month: number, day: number, hour = 9, zone = NY): number =>
	zonedToUtc({ year, month, day, hour }, zone);
const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
	id: 'm1',
	title: 'Review',
	description: '',
	zone: NY,
	start: at(2026, 10, 15),
	end: at(2026, 10, 15) + HOUR_MS,
	repeat: 'monthly',
	...over,
});
const FAR = 1e15;
/** The local `YYYY-MM-DD` dates of every occurrence. */
const dates = (m: CalendarEvent, from = 0, to = FAR): string[] =>
	occurrencesBetween(m, from, to).map((o) => {
		const p = zonedParts(o.start, m.zone);
		return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
	});

describe('weekday ordinal helpers', () => {
	it('finds the nth and the last weekday of a month', () => {
		// October 2026 starts on a Thursday; weekday 2 is Tuesday, 5 is Friday.
		expect(nthWeekdayOfMonth(2026, 10, 2, 3)).toBe(20);
		expect(nthWeekdayOfMonth(2026, 10, 5, -1)).toBe(30);
		expect(nthWeekdayOfMonth(2026, 11, 5, -1)).toBe(27);
		expect(nthWeekdayOfMonth(2026, 11, 0, 1)).toBe(1);
		// February 2028 (leap) ends on a Tuesday.
		expect(nthWeekdayOfMonth(2028, 2, 2, -1)).toBe(29);
	});

	it('maps a day to an ordinal, and checks one against a date', () => {
		expect(ordinalOfDay(1)).toBe(1);
		expect(ordinalOfDay(14)).toBe(2);
		expect(ordinalOfDay(28)).toBe(4);
		expect(ordinalOfDay(29)).toBe(-1);
		expect(dayMatchesOrdinal(2026, 10, 30, -1)).toBe(true);
		expect(dayMatchesOrdinal(2026, 10, 23, -1)).toBe(false);
		expect(dayMatchesOrdinal(2026, 10, 23, 4)).toBe(true);
		expect(dayMatchesOrdinal(2026, 10, 20, 4)).toBe(false);
		expect(dayMatchesOrdinal(2026, 10, 20, 5)).toBe(false);
	});
});

describe('monthly on a date', () => {
	it('repeats on the same day each month', () => {
		const m = event({ count: 4 });
		expect(dates(m)).toEqual(['2026-10-15', '2026-11-15', '2026-12-15', '2027-01-15']);
	});

	it('skips months without a 31st and does not count them', () => {
		const m = event({ start: at(2026, 1, 31), end: at(2026, 1, 31) + HOUR_MS, count: 5 });
		expect(dates(m)).toEqual([
			'2026-01-31',
			'2026-03-31',
			'2026-05-31',
			'2026-07-31',
			'2026-08-31',
		]);
	});

	it('skips months without a 30th (only February)', () => {
		const m = event({ start: at(2026, 1, 30), end: at(2026, 1, 30) + HOUR_MS, count: 3 });
		expect(dates(m)).toEqual(['2026-01-30', '2026-03-30', '2026-04-30']);
	});

	it('includes 29 February only in a leap year', () => {
		const m = event({
			start: at(2027, 1, 29),
			end: at(2027, 1, 29) + HOUR_MS,
			until: at(2028, 4, 1),
		});
		expect(dates(m)).toEqual([
			'2027-01-29',
			'2027-03-29',
			'2027-04-29',
			'2027-05-29',
			'2027-06-29',
			'2027-07-29',
			'2027-08-29',
			'2027-09-29',
			'2027-10-29',
			'2027-11-29',
			'2027-12-29',
			'2028-01-29',
			'2028-02-29',
			'2028-03-29',
		]);
		// 2027 is not a leap year, so there is no 29 February in it.
		expect(dates(m)).not.toContain('2027-02-29');
	});

	it('keeps counting through the end of a year', () => {
		const m = event({ start: at(2026, 11, 30), end: at(2026, 11, 30) + HOUR_MS, count: 3 });
		expect(dates(m)).toEqual(['2026-11-30', '2026-12-30', '2027-01-30']);
	});

	it('answers a window far from the start without the early occurrences', () => {
		const m = event();
		const from = at(2030, 6, 1);
		expect(dates(m, from, at(2030, 8, 31))).toEqual(['2030-06-15', '2030-07-15', '2030-08-15']);
		expect(occurrenceAt(m, at(2030, 6, 15))?.index).toBe(44);
	});

	it('numbers occurrences by those that exist, so a skipped month has no index', () => {
		const m = event({ start: at(2026, 1, 31), end: at(2026, 1, 31) + HOUR_MS });
		expect(seriesIndexOf(m, at(2026, 3, 31))).toBe(1);
		expect(seriesIndexOf(m, at(2026, 5, 31))).toBe(2);
		expect(seriesIndexOf(m, at(2026, 4, 30))).toBeNull();
		expect(seriesIndexOf(m, at(2026, 2, 28))).toBeNull();
		// Right date, wrong time of day.
		expect(seriesIndexOf(m, at(2026, 3, 31, 10))).toBeNull();
	});

	it('stops at an end date, keeping an occurrence that starts on it', () => {
		const m = event({ until: at(2026, 12, 15) });
		expect(dates(m)).toEqual(['2026-10-15', '2026-11-15', '2026-12-15']);
		expect(dates(event({ until: at(2026, 12, 15) - 1 }))).toEqual(['2026-10-15', '2026-11-15']);
	});

	it('lets a cancelled occurrence drop out and a changed one move', () => {
		const m = event({
			count: 4,
			exceptions: [
				{ originalStart: at(2026, 11, 15), cancelled: true },
				{
					originalStart: at(2026, 12, 15),
					cancelled: false,
					start: at(2026, 12, 16, 14),
					end: at(2026, 12, 16, 15),
				},
			],
		});
		expect(dates(m)).toEqual(['2026-10-15', '2026-12-16', '2027-01-15']);
	});
});

describe('monthly on a weekday ordinal', () => {
	it('repeats on the third Tuesday', () => {
		const m = event({
			start: at(2026, 10, 20),
			end: at(2026, 10, 20) + HOUR_MS,
			monthlyBy: 'weekday',
			ordinal: 3,
			count: 4,
		});
		expect(dates(m)).toEqual(['2026-10-20', '2026-11-17', '2026-12-15', '2027-01-19']);
	});

	it('repeats on the last Friday, whatever the month length', () => {
		const m = event({
			start: at(2026, 10, 30),
			end: at(2026, 10, 30) + HOUR_MS,
			monthlyBy: 'weekday',
			ordinal: -1,
			count: 5,
		});
		expect(dates(m)).toEqual([
			'2026-10-30',
			'2026-11-27',
			'2026-12-25',
			'2027-01-29',
			'2027-02-26',
		]);
	});

	it('tells "fourth" from "last" when a date is both', () => {
		// 23 October 2026 is the fourth and not the last Friday; 27 November is both.
		const fourth = event({
			start: at(2026, 10, 23),
			end: at(2026, 10, 23) + HOUR_MS,
			monthlyBy: 'weekday',
			ordinal: 4,
			count: 3,
		});
		expect(dates(fourth)).toEqual(['2026-10-23', '2026-11-27', '2026-12-25']);
		const last = { ...fourth, ordinal: -1 };
		// -1 does not fit 23 October, but the anchor stays the first occurrence, then follows the rule.
		expect(dates(last).slice(1)).toEqual(['2026-11-27', '2026-12-25']);
	});

	it('uses the last weekday of a leap February', () => {
		const m = event({
			start: at(2027, 1, 26),
			end: at(2027, 1, 26) + HOUR_MS,
			monthlyBy: 'weekday',
			ordinal: -1,
			count: 14,
		});
		const all = dates(m);
		expect(all[1]).toBe('2027-02-23');
		// Last Tuesday of February 2028 is the 29th.
		expect(all[13]).toBe('2028-02-29');
	});

	it('finds the index of a weekday occurrence', () => {
		const m = event({
			start: at(2026, 10, 20),
			end: at(2026, 10, 20) + HOUR_MS,
			monthlyBy: 'weekday',
			ordinal: 3,
		});
		expect(seriesIndexOf(m, at(2026, 12, 15))).toBe(2);
		expect(seriesIndexOf(m, at(2026, 12, 22))).toBeNull();
	});
});

describe('yearly', () => {
	it('repeats on the same date each year', () => {
		const m = event({ repeat: 'yearly', count: 3 });
		expect(dates(m)).toEqual(['2026-10-15', '2027-10-15', '2028-10-15']);
	});

	it('repeats 29 February only in leap years', () => {
		const m = event({
			repeat: 'yearly',
			start: at(2028, 2, 29),
			end: at(2028, 2, 29) + HOUR_MS,
			count: 3,
		});
		expect(dates(m)).toEqual(['2028-02-29', '2032-02-29', '2036-02-29']);
	});

	it('skips 2100, which is not a leap year', () => {
		const m = event({
			repeat: 'yearly',
			start: at(2096, 2, 29),
			end: at(2096, 2, 29) + HOUR_MS,
			count: 2,
		});
		expect(dates(m)).toEqual(['2096-02-29', '2104-02-29']);
	});

	it('ends on a date', () => {
		const m = event({ repeat: 'yearly', until: at(2028, 10, 14) });
		expect(dates(m)).toEqual(['2026-10-15', '2027-10-15']);
	});
});

describe('daylight saving', () => {
	it('keeps 09:00 on the organiser clock across both changes', () => {
		const m = event({ start: at(2026, 10, 15), end: at(2026, 10, 15) + HOUR_MS, count: 8 });
		const all = occurrencesBetween(m, 0, FAR);
		expect(all).toHaveLength(8);
		for (const o of all) expect(minuteOfDay(o.start, NY)).toBe(9 * 60);
		// 1 Nov 2026 (fall back) is between the 15 Oct and 15 Nov occurrences: 31 days + 1 hour.
		expect(all[1]!.start - all[0]!.start).toBe(31 * 24 * HOUR_MS + HOUR_MS);
		// 14 Mar 2027 (spring forward) is between 15 Feb and 15 Mar: 28 days minus 1 hour.
		expect(all[5]!.start - all[4]!.start).toBe(28 * 24 * HOUR_MS - HOUR_MS);
		expect(all[6]!.start - all[5]!.start).toBe(31 * 24 * HOUR_MS);
	});

	it('lands a 02:30 occurrence on the spring-forward day after the gap', () => {
		const m = event({
			start: at(2027, 2, 14, 2),
			end: at(2027, 2, 14, 2) + HOUR_MS,
			count: 2,
		});
		const second = occurrencesBetween(m, 0, FAR)[1]!;
		// 14 March 2027, 02:00 does not exist in New York; the clock reads 03:00.
		expect(zonedParts(second.start, NY)).toMatchObject({ month: 3, day: 14, hour: 3 });
	});

	it('keeps the third Tuesday at 09:00 across the autumn change', () => {
		const m = event({
			start: at(2026, 10, 20),
			end: at(2026, 10, 20) + HOUR_MS,
			monthlyBy: 'weekday',
			ordinal: 3,
			count: 3,
		});
		for (const o of occurrencesBetween(m, 0, FAR)) expect(minuteOfDay(o.start, NY)).toBe(540);
	});

	it('does not move a yearly occurrence in a southern-hemisphere zone', () => {
		const SYD = 'Australia/Sydney';
		const m = event({
			repeat: 'yearly',
			zone: SYD,
			start: at(2026, 4, 5, 10, SYD),
			end: at(2026, 4, 5, 11, SYD),
			count: 3,
		});
		for (const o of occurrencesBetween(m, 0, FAR)) expect(minuteOfDay(o.start, SYD)).toBe(600);
		expect(dates(m)).toEqual(['2026-04-05', '2027-04-05', '2028-04-05']);
	});

	it('resolves dates in the organiser zone, not the viewer zone', () => {
		// 23:30 in Auckland is the previous UTC day: the date rule follows Auckland.
		const AKL = 'Pacific/Auckland';
		const m = event({
			zone: AKL,
			start: at(2026, 10, 31, 23, AKL),
			end: at(2026, 10, 31, 23, AKL) + HOUR_MS,
			count: 3,
		});
		expect(dates(m)).toEqual(['2026-10-31', '2026-12-31', '2027-01-31']);
	});
});
