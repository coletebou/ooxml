import { layoutDay } from './layout';
import type { CalendarEvent } from './model';
import { type Occurrence, occurrencesBetween } from './occurrences';
import { DAY_MS, minuteOfDay, zonedToUtc } from './time-zone';
import { eventsByDay, viewDays } from './views';

const NY = 'America/New_York';

describe('day layout', () => {
	const day = { start: 0, end: DAY_MS };
	const occ = (id: string, from: number, to: number): Occurrence => ({
		key: id,
		eventId: id,
		start: from * 60_000,
		end: to * 60_000,
		index: 0,
	});
	it('puts overlapping events side by side and lets later ones reuse the width', () => {
		const placed = layoutDay(
			[occ('a', 540, 600), occ('b', 570, 630), occ('c', 600, 660), occ('d', 720, 780)],
			day,
			'UTC',
		);
		const by = Object.fromEntries(placed.map((p) => [p.occurrence.key, p]));
		expect([by.a!.column, by.b!.column]).toEqual([0, 1]);
		expect(by.c!.column).toBe(0);
		expect([by.a!.columns, by.b!.columns, by.c!.columns]).toEqual([2, 2, 2]);
		expect([by.d!.column, by.d!.columns]).toEqual([0, 1]);
	});

	it('clips an event that crosses midnight to each day', () => {
		const late = occ('late', 23 * 60, 25 * 60);
		const [first] = layoutDay([late], day, 'UTC');
		expect([first!.startMinute, first!.endMinute]).toEqual([1380, 1440]);
		const [second] = layoutDay([late], { start: DAY_MS, end: 2 * DAY_MS }, 'UTC');
		expect([second!.startMinute, second!.endMinute]).toEqual([0, 60]);
	});

	it('renders an event in the viewer zone, not the event zone', () => {
		const m: CalendarEvent = {
			id: 'm1',
			title: 'Stand-up',
			description: '',
			zone: 'Asia/Tokyo',
			start: zonedToUtc({ year: 2026, month: 3, day: 5, hour: 9 }, NY),
			end: zonedToUtc({ year: 2026, month: 3, day: 5, hour: 9, minute: 30 }, NY),
			repeat: 'none',
		};
		const today = viewDays(m.start, 'day', NY)[0]!;
		const [placed] = layoutDay(occurrencesBetween(m, today.start, today.end), today, NY);
		expect(placed!.startMinute).toBe(minuteOfDay(m.start, NY));
		expect(placed!.endMinute - placed!.startMinute).toBe(30);
	});

	it('places an event without length on the day it starts, midnight included', () => {
		// An imported DTSTART alone is such an event (RFC 5545 3.6.1); the views list it on that day.
		const midnight = occ('m', 0, 0);
		const placed = layoutDay([midnight, occ('n', 600, 600)], day, 'UTC');
		expect(placed.map((p) => [p.occurrence.key, p.startMinute, p.endMinute])).toEqual([
			['m', 0, 1],
			['n', 600, 600],
		]);
		expect(placed.map((p) => p.occurrence)).toEqual(
			eventsByDay([midnight, occ('n', 600, 600)], [day], 'UTC').get(day.start),
		);
		// One at the next midnight belongs to the next day.
		expect(layoutDay([occ('next', 1440, 1440)], day, 'UTC')).toEqual([]);
		expect(layoutDay([occ('next', 1440, 1440)], { start: DAY_MS, end: 2 * DAY_MS }, 'UTC')).toEqual(
			[expect.objectContaining({ startMinute: 0, endMinute: 1 })],
		);
	});

	it('keeps the type of what it places', () => {
		const tagged = { ...occ('a', 60, 120), color: 'blue' };
		expect(layoutDay([tagged], day, 'UTC')[0]?.occurrence.color).toBe('blue');
	});
});
