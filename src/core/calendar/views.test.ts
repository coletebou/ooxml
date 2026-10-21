import type { Occurrence } from './occurrences';
import { DAY_MS, HOUR_MS, minuteOfDay, zonedParts, zonedToUtc } from './time-zone';
import { addMonths, eventsByDay, monthGrid, shiftAnchor, viewDays } from './views';

const NY = 'America/New_York';
const at = (year: number, month: number, day: number, hour = 0, zone = NY): number =>
	zonedToUtc({ year, month, day, hour }, zone);
const date = (ms: number, zone = NY): string => {
	const p = zonedParts(ms, zone);
	return `${p.year}-${p.month}-${p.day} ${p.hour}:${String(p.minute).padStart(2, '0')}`;
};

describe('week view', () => {
	const thursday = zonedToUtc({ year: 2026, month: 10, day: 15, hour: 14 }, NY);
	it('shows Monday to Friday, Monday to Sunday or one day in the viewer zone', () => {
		const work = viewDays(thursday, 'workweek', NY);
		expect(work.map((d) => d.day)).toEqual([12, 13, 14, 15, 16]);
		expect(viewDays(thursday, 'week', NY).map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
		expect(viewDays(thursday, 'day', NY).map((d) => d.day)).toEqual([15]);
		expect(work[0]!.end).toBe(work[1]!.start);
	});

	it('steps by a day or a week', () => {
		expect(viewDays(shiftAnchor(thursday, 'week', 1, NY), 'week', NY)[0]!.day).toBe(19);
		expect(viewDays(shiftAnchor(thursday, 'day', -1, NY), 'day', NY)[0]!.day).toBe(14);
	});

	it('starts the week on another day, keeping the work week Monday to Friday', () => {
		expect(viewDays(thursday, 'week', NY, 0).map((d) => d.day)).toEqual([
			11, 12, 13, 14, 15, 16, 17,
		]);
		const sunday = at(2026, 10, 18, 10);
		expect(viewDays(sunday, 'week', NY, 0).map((d) => d.day)).toEqual([18, 19, 20, 21, 22, 23, 24]);
		expect(viewDays(sunday, 'workweek', NY, 0).map((d) => d.day)).toEqual([19, 20, 21, 22, 23]);
		expect(viewDays(sunday, 'workweek', NY).map((d) => d.day)).toEqual([12, 13, 14, 15, 16]);
		const saturday = at(2026, 10, 17, 10);
		expect(viewDays(saturday, 'week', NY, 6).map((d) => d.weekday)).toEqual([6, 0, 1, 2, 3, 4, 5]);
	});
});

describe('month view', () => {
	it('is six weeks from the Monday on or before the first, marking the days of the month', () => {
		// October 2026 starts on a Thursday.
		const grid = monthGrid(at(2026, 10, 20, 15), NY);
		expect(grid).toHaveLength(6);
		expect(grid.every((week) => week.length === 7)).toBe(true);
		expect(grid[0]!.map((d) => [d.month, d.day, d.inMonth])).toEqual([
			[9, 28, false],
			[9, 29, false],
			[9, 30, false],
			[10, 1, true],
			[10, 2, true],
			[10, 3, true],
			[10, 4, true],
		]);
		const days = grid.flat();
		expect(days.filter((d) => d.inMonth).map((d) => d.day)).toEqual(
			Array.from({ length: 31 }, (_, i) => i + 1),
		);
		expect(days.at(-1)).toMatchObject({ month: 11, day: 8, weekday: 0, inMonth: false });
		expect(grid.every((week) => week[0]!.weekday === 1)).toBe(true);
	});

	it('runs day after day without gaps, a 25-hour day where the clocks go back', () => {
		const days = monthGrid(at(2026, 11, 5), NY).flat();
		for (let i = 1; i < days.length; i++) expect(days[i]!.start).toBe(days[i - 1]!.end);
		const fallBack = days.find((d) => d.month === 11 && d.day === 1)!;
		expect(fallBack.end - fallBack.start).toBe(DAY_MS + HOUR_MS);
		expect(days.every((d) => minuteOfDay(d.start, NY) === 0)).toBe(true);
	});

	it('starts the week on Sunday when asked, and fits a February that starts on one', () => {
		// 1 February 2026 is a Sunday: four whole weeks, then two of March.
		const grid = monthGrid(at(2026, 2, 10), NY, 0);
		expect(grid[0]![0]).toMatchObject({ month: 2, day: 1, weekday: 0, inMonth: true });
		expect(grid[4]![0]).toMatchObject({ month: 3, day: 1, inMonth: false });
		expect(grid.flat().filter((d) => d.inMonth)).toHaveLength(28);
		expect(monthGrid(at(2026, 2, 10), NY)[0]![0]).toMatchObject({ month: 1, day: 26 });
	});

	it('takes the month of the anchor in the viewer zone', () => {
		// 23:00 on 31 October in New York is already 1 November in Tokyo.
		const anchor = at(2026, 10, 31, 23);
		const tokyo = monthGrid(anchor, 'Asia/Tokyo')
			.flat()
			.filter((d) => d.inMonth);
		expect(tokyo[0]).toMatchObject({ month: 11, day: 1 });
		expect(
			monthGrid(anchor, NY)
				.flat()
				.filter((d) => d.inMonth)[0],
		).toMatchObject({ month: 10 });
	});

	it('starts each day at its own midnight where a clock change skips one', () => {
		// 6 September 2026 has no midnight in Santiago: the clocks go from 00:00 to 01:00.
		const zone = 'America/Santiago';
		const days = monthGrid(at(2026, 9, 15, 12, zone), zone).flat();
		const gap = days.find((d) => d.month === 9 && d.day === 6)!;
		expect(minuteOfDay(gap.start, zone)).toBe(60);
		expect(days.filter((d) => d !== gap).every((d) => minuteOfDay(d.start, zone) === 0)).toBe(true);
	});

	it('is what the month mode of viewDays shows', () => {
		const anchor = at(2026, 10, 20, 15);
		expect(viewDays(anchor, 'month', NY)).toEqual(monthGrid(anchor, NY).flat());
		expect(viewDays(anchor, 'month', NY, 0)[0]).toMatchObject({ month: 9, day: 27 });
	});
});

describe('month steps', () => {
	it('keeps the day of the month, or the last day of a shorter month', () => {
		expect(date(shiftAnchor(at(2026, 1, 31, 10), 'month', 1, NY))).toBe('2026-2-28 10:00');
		expect(date(shiftAnchor(at(2028, 1, 31, 10), 'month', 1, NY))).toBe('2028-2-29 10:00');
		expect(date(shiftAnchor(at(2026, 3, 31, 10), 'month', -1, NY))).toBe('2026-2-28 10:00');
		expect(date(shiftAnchor(at(2026, 5, 15, 10), 'month', 1, NY))).toBe('2026-6-15 10:00');
	});

	it('crosses years and keeps the local time across daylight saving', () => {
		expect(date(shiftAnchor(at(2026, 12, 15, 9), 'month', 1, NY))).toBe('2027-1-15 9:00');
		expect(date(shiftAnchor(at(2026, 1, 15, 9), 'month', -1, NY))).toBe('2025-12-15 9:00');
		// 15 February is standard time and 15 March daylight time in New York.
		expect(date(shiftAnchor(at(2026, 3, 15, 9), 'month', -1, NY))).toBe('2026-2-15 9:00');
		expect(date(addMonths(at(2028, 2, 29, 9), 12, NY))).toBe('2029-2-28 9:00');
		expect(date(addMonths(at(2026, 10, 15, 9), -22, NY))).toBe('2024-12-15 9:00');
	});

	it('steps in the given zone', () => {
		const tokyo = 'Asia/Tokyo';
		// 1 February 05:00 in Tokyo is still 31 January in New York.
		const anchor = at(2026, 2, 1, 5, tokyo);
		expect(date(shiftAnchor(anchor, 'month', 1, tokyo), tokyo)).toBe('2026-3-1 5:00');
		expect(date(shiftAnchor(anchor, 'month', 1, NY))).toBe('2026-2-28 15:00');
	});
});

describe('events by day', () => {
	const days = viewDays(at(2026, 10, 15, 12), 'week', NY);
	const occ = (
		key: string,
		start: number,
		end: number,
		extra: Partial<Occurrence> = {},
	): Occurrence => ({
		key,
		eventId: key,
		start,
		end,
		index: 0,
		...extra,
	});
	const keys = (byDay: Map<number, Occurrence[]>): string[][] =>
		days.map((d) => (byDay.get(d.start) ?? []).map((o) => o.key));

	it('puts timed occurrences on every day they touch, sorted by start', () => {
		const byDay = eventsByDay(
			[
				occ('late', at(2026, 10, 13, 15), at(2026, 10, 13, 16)),
				occ('early', at(2026, 10, 13, 9), at(2026, 10, 13, 10)),
				occ('overnight', at(2026, 10, 14, 22), at(2026, 10, 16, 2)),
				occ('to-midnight', at(2026, 10, 12, 23), at(2026, 10, 13)),
				occ('instant', at(2026, 10, 18), at(2026, 10, 18)),
			],
			days,
			NY,
		);
		expect(keys(byDay)).toEqual([
			['to-midnight'],
			['early', 'late'],
			['overnight'],
			['overnight'],
			['overnight'],
			[],
			['instant'],
		]);
	});

	it('puts all-day occurrences on their dates in any zone, before the timed ones', () => {
		// Made in Tokyo: its instants are the afternoon before in New York, its dates are not.
		const tokyo = 'Asia/Tokyo';
		const holiday = occ('holiday', at(2026, 10, 15, 0, tokyo), at(2026, 10, 17, 0, tokyo), {
			dates: { start: '2026-10-15', end: '2026-10-17' },
		});
		const meeting = occ('meeting', at(2026, 10, 15, 8), at(2026, 10, 15, 9));
		const byDay = eventsByDay([meeting, holiday], days, NY);
		expect(keys(byDay)).toEqual([[], [], [], ['holiday', 'meeting'], ['holiday'], [], []]);
	});

	it('lists every day, longer first on the same start', () => {
		const byDay = eventsByDay(
			[
				occ('short', at(2026, 10, 12, 9), at(2026, 10, 12, 10)),
				occ('long', at(2026, 10, 12, 9), at(2026, 10, 12, 12)),
			],
			days,
			NY,
		);
		expect([...byDay.keys()]).toEqual(days.map((d) => d.start));
		expect(keys(byDay)[0]).toEqual(['long', 'short']);
	});
});
