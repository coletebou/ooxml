import type { CalendarEvent } from './model';
import { dueOccurrences, occurrenceAt, occurrenceEnd, occurrencesBetween } from './occurrences';
import { DAY_MS, HOUR_MS, minuteOfDay, zonedToUtc } from './time-zone';

const NY = 'America/New_York';
const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
	id: 'm1',
	title: 'Stand-up',
	description: '',
	zone: NY,
	start: zonedToUtc({ year: 2026, month: 3, day: 5, hour: 9 }, NY),
	end: zonedToUtc({ year: 2026, month: 3, day: 5, hour: 9, minute: 30 }, NY),
	repeat: 'none',
	...over,
});
const midnight = (month: number, day: number, zone = NY): number =>
	zonedToUtc({ year: 2026, month, day }, zone);

describe('occurrences', () => {
	it('returns a single event only inside the range', () => {
		const m = event();
		expect(occurrencesBetween(m, m.start - HOUR_MS, m.end + HOUR_MS)).toHaveLength(1);
		expect(occurrencesBetween(m, m.end, m.end + HOUR_MS)).toHaveLength(0);
		expect(occurrencesBetween(m, m.start - HOUR_MS, m.start)).toHaveLength(0);
		expect(occurrencesBetween(event({ cancelled: true }), 0, 1e15)).toEqual([]);
	});

	it('repeats daily at the wall time across the spring-forward change', () => {
		const m = event({ repeat: 'daily' });
		const week = occurrencesBetween(m, m.start, m.start + 6.5 * DAY_MS);
		expect(week).toHaveLength(7);
		for (const o of week) expect(minuteOfDay(o.start, NY)).toBe(9 * 60);
		// 8 March 2026 is the New York DST change: that day is one hour shorter.
		expect(week[3]!.start - week[2]!.start).toBe(DAY_MS - HOUR_MS);
		expect(week.every((o) => o.end - o.start === 30 * 60_000)).toBe(true);
	});

	it('ends each occurrence of a length in days on the clock that many days after its start', () => {
		// 09:00 to 09:00 the next day, then two more hours; 8 March is the spring change.
		const start = zonedToUtc({ year: 2026, month: 3, day: 6, hour: 9 }, NY);
		const at = (day: number, hour: number): number =>
			zonedToUtc({ year: 2026, month: 3, day, hour }, NY);
		const shift = event({ start, end: at(7, 11), repeat: 'daily', count: 3, nominalDays: 1 });
		const spans = (e: CalendarEvent): number[] =>
			occurrencesBetween(e, start, at(10, 0)).map((o) => o.end - o.start);
		expect(spans(shift)).toEqual([26 * HOUR_MS, 25 * HOUR_MS, 26 * HOUR_MS]);
		expect(occurrenceEnd(shift, at(7, 9))).toBe(at(8, 11));
		// A changed occurrence that only moves keeps the length its new start gives it.
		const moved = {
			...shift,
			exceptions: [{ originalStart: at(8, 9), cancelled: false, start: at(7, 12) }],
		};
		expect(occurrencesBetween(moved, start, at(10, 0)).find((o) => o.changed)).toMatchObject({
			start: at(7, 12),
			end: at(8, 14),
		});
		// An end moved to less than those days makes a length like any other, exact.
		expect(spans({ ...shift, end: start + 2 * HOUR_MS })).toEqual([
			2 * HOUR_MS,
			2 * HOUR_MS,
			2 * HOUR_MS,
		]);
		// A whole-day event already counts whole days.
		const allDay = event({
			allDay: true,
			start: midnight(3, 7),
			end: midnight(3, 8),
			nominalDays: 3,
		});
		expect(occurrenceEnd(allDay, midnight(3, 8))).toBe(midnight(3, 9));
	});

	it('repeats weekly on the same weekday and never before its first start', () => {
		const m = event({ repeat: 'weekly' });
		const month = occurrencesBetween(m, m.start - 30 * DAY_MS, m.start + 28 * DAY_MS);
		expect(month.map((o) => o.index)).toEqual([0, 1, 2, 3, 4]);
		expect(month[1]!.start - month[0]!.start).toBeGreaterThanOrEqual(7 * DAY_MS - HOUR_MS);
		expect(new Set(month.map((o) => o.key)).size).toBe(5);
	});

	it('finds a late occurrence without walking from the start', () => {
		const m = event({ repeat: 'daily' });
		const far = m.start + 1000 * DAY_MS;
		const found = occurrencesBetween(m, far, far + DAY_MS);
		expect(found.length).toBeGreaterThanOrEqual(1);
		expect(found.length).toBeLessThanOrEqual(2);
	});

	it('names its event and carries no dates when it is timed', () => {
		const m = event();
		expect(occurrencesBetween(m, 0, 1e15)).toEqual([
			{ key: `m1@${m.start}`, eventId: 'm1', start: m.start, end: m.end, index: 0 },
		]);
	});
});

describe('all-day occurrences', () => {
	const holiday = (over: Partial<CalendarEvent> = {}): CalendarEvent =>
		event({ allDay: true, start: midnight(3, 6), end: midnight(3, 7), ...over });

	it('lasts whole days in its zone, 23 hours on the spring-forward day', () => {
		const m = holiday({ repeat: 'daily', count: 3 });
		const all = occurrencesBetween(m, 0, 1e15);
		expect(all.map((o) => o.dates)).toEqual([
			{ start: '2026-03-06', end: '2026-03-07' },
			{ start: '2026-03-07', end: '2026-03-08' },
			{ start: '2026-03-08', end: '2026-03-09' },
		]);
		expect(all.map((o) => o.end - o.start)).toEqual([DAY_MS, DAY_MS, DAY_MS - HOUR_MS]);
		expect(all.every((o) => minuteOfDay(o.start, NY) === 0 && minuteOfDay(o.end, NY) === 0)).toBe(
			true,
		);
	});

	it('finds an occurrence by its last hour, even when the day is 25 hours long', () => {
		// 1 November 2026 is 25 hours long in New York.
		const m = holiday({ start: midnight(10, 25), end: midnight(10, 26), repeat: 'weekly' });
		const lastHour = midnight(11, 2) - HOUR_MS / 2;
		const [o] = occurrencesBetween(m, lastHour, lastHour + 1);
		expect(o?.dates).toEqual({ start: '2026-11-01', end: '2026-11-02' });
		expect(o!.end - o!.start).toBe(DAY_MS + HOUR_MS);
	});

	it('spans several days and moves whole with an exception', () => {
		const trip = holiday({
			start: midnight(4, 3),
			end: midnight(4, 6),
			repeat: 'yearly',
			exceptions: [
				{ originalStart: zonedToUtc({ year: 2027, month: 4, day: 3 }, NY), cancelled: true },
			],
		});
		const found = occurrencesBetween(trip, 0, Date.UTC(2029, 0, 1));
		expect(found.map((o) => o.dates)).toEqual([
			{ start: '2026-04-03', end: '2026-04-06' },
			{ start: '2028-04-03', end: '2028-04-06' },
		]);
		expect(occurrenceEnd(trip, found[1]!.start)).toBe(found[1]!.end);
	});
});

describe('occurrences without length', () => {
	it('counts at its start, also at the start of the range', () => {
		const m = event({ end: event().start });
		expect(occurrencesBetween(m, m.start, m.start + HOUR_MS)).toHaveLength(1);
		expect(occurrencesBetween(m, m.start - HOUR_MS, m.start)).toHaveLength(0);
		expect(occurrenceAt(m, m.start)?.end).toBe(m.start);
		const daily = event({ end: event().start, repeat: 'daily' });
		expect(occurrencesBetween(daily, daily.start + DAY_MS, daily.start + 2 * DAY_MS)).toHaveLength(
			1,
		);
	});
});

describe('reminders', () => {
	it('is due in the five minutes before an occurrence starts', () => {
		const m = event({ repeat: 'daily' });
		const next = m.start + DAY_MS;
		expect(dueOccurrences([m], next - 6 * 60_000)).toEqual([]);
		const due = dueOccurrences([m], next - 4 * 60_000);
		expect(due.map((d) => d.occurrence.start)).toEqual([
			zonedToUtc({ year: 2026, month: 3, day: 6, hour: 9 }, NY),
		]);
		expect(due[0]!.event).toBe(m);
		expect(dueOccurrences([m], next + 1)).toEqual([]);
		expect(dueOccurrences([event({ cancelled: true })], m.start - 60_000)).toEqual([]);
	});

	it('takes another lead and keeps the caller type', () => {
		const tagged = { ...event({ repeat: 'daily' }), color: 'blue' };
		const due = dueOccurrences([tagged], tagged.start - 14 * 60_000, 15 * 60_000);
		expect(due.map((d) => d.event.color)).toEqual(['blue']);
	});
});
