import * as Y from 'yjs';
import { occurrencesBetween } from './calendar';
import { meetingToIcs } from './ics';
import { createMeetingStore, type Meeting } from './meetings';
import { HOUR_MS, zonedParts, zonedToUtc } from './time-zone';

// Monthly and yearly dates, weekday ordinals and daylight saving are tested with the calendar area
// (src/core/calendar/recurrence-calendar.test.ts); this file pins the .ics rules of a meeting and
// how the meeting store keeps a monthly pattern.
const NY = 'America/New_York';
const at = (year: number, month: number, day: number, hour = 9, zone = NY): number =>
	zonedToUtc({ year, month, day, hour }, zone);
const meeting = (over: Partial<Meeting> = {}): Meeting => ({
	id: 'm1',
	title: 'Review',
	description: '',
	organizerId: 'ada',
	organizerName: 'Ada',
	zone: NY,
	start: at(2026, 10, 15),
	end: at(2026, 10, 15) + HOUR_MS,
	repeat: 'monthly',
	attendees: [],
	createdAt: 0,
	cancelled: false,
	...over,
});
const FAR = 1e15;
/** The local `YYYY-MM-DD` dates of every occurrence. */
const dates = (m: Meeting, from = 0, to = FAR): string[] =>
	occurrencesBetween(m, from, to).map((o) => {
		const p = zonedParts(o.start, m.zone);
		return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
	});

describe('.ics rules', () => {
	const rrule = (m: Meeting): string | undefined =>
		meetingToIcs(m, { now: 0 })
			.split('\r\n')
			.find(
				(l) =>
					l.startsWith('RRULE:FREQ=MONTHLY') ||
					l.startsWith('RRULE:FREQ=YEARLY;BYMONTH=10;BYMONTHDAY'),
			);

	it('writes BYMONTHDAY for a monthly date repeat', () => {
		expect(rrule(meeting({ count: 4 }))).toBe('RRULE:FREQ=MONTHLY;BYMONTHDAY=15;COUNT=4');
	});

	it('writes BYDAY with an ordinal for a weekday repeat', () => {
		const third = meeting({
			start: at(2026, 10, 20),
			end: at(2026, 10, 20) + HOUR_MS,
			monthlyBy: 'weekday',
			ordinal: 3,
		});
		expect(rrule(third)).toBe('RRULE:FREQ=MONTHLY;BYDAY=3TU');
		const last = meeting({
			start: at(2026, 10, 30),
			end: at(2026, 10, 30) + HOUR_MS,
			monthlyBy: 'weekday',
			ordinal: -1,
			until: at(2027, 12, 31),
		});
		expect(rrule(last)).toMatch(/^RRULE:FREQ=MONTHLY;BYDAY=-1FR;UNTIL=\d{8}T\d{6}Z$/u);
	});

	it('writes BYMONTH and BYMONTHDAY for a yearly repeat, in the organiser zone', () => {
		expect(rrule(meeting({ repeat: 'yearly' }))).toBe('RRULE:FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=15');
		const AKL = 'Pacific/Auckland';
		const akl = meeting({
			repeat: 'yearly',
			zone: AKL,
			start: at(2026, 10, 31, 23, AKL),
			end: at(2026, 10, 31, 23, AKL) + HOUR_MS,
		});
		expect(rrule(akl)).toBe('RRULE:FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=31');
	});

	it('writes a 31st as BYMONTHDAY=31, which RFC 5545 skips in short months', () => {
		const m = meeting({ start: at(2026, 1, 31), end: at(2026, 1, 31) + HOUR_MS });
		expect(rrule(m)).toBe('RRULE:FREQ=MONTHLY;BYMONTHDAY=31');
	});

	it('lists cancelled occurrences as EXDATEs of a monthly series', () => {
		const out = meetingToIcs(
			meeting({ exceptions: [{ originalStart: at(2026, 11, 15), cancelled: true }] }),
			{ now: 0 },
		);
		expect(out).toContain('EXDATE;TZID=America/New_York:20261115T090000');
	});
});

describe('stored monthly meetings', () => {
	const open = () => {
		const doc = new Y.Doc();
		return createMeetingStore(doc, { id: 'ada', name: 'Ada' }, () => 1);
	};
	const base = {
		title: 'Review',
		zone: NY,
		start: at(2026, 10, 20),
		end: at(2026, 10, 20) + HOUR_MS,
	};

	it('round-trips a monthly weekday rule', () => {
		const store = open();
		const m = store.create({
			...base,
			repeat: 'monthly',
			monthlyBy: 'weekday',
			ordinal: 3,
			count: 3,
		});
		expect(m).toMatchObject({ repeat: 'monthly', monthlyBy: 'weekday', ordinal: 3, count: 3 });
		expect(dates(store.get(m!.id)!)).toEqual(['2026-10-20', '2026-11-17', '2026-12-15']);
	});

	it('derives the ordinal from the start when none is given', () => {
		const store = open();
		expect(store.create({ ...base, repeat: 'monthly', monthlyBy: 'weekday' })).toMatchObject({
			ordinal: 3,
		});
		const fourth = store.create({
			...base,
			start: at(2026, 10, 23),
			end: at(2026, 10, 23) + HOUR_MS,
			repeat: 'monthly',
			monthlyBy: 'weekday',
		});
		expect(fourth).toMatchObject({ ordinal: 4 });
		const last = store.create({
			...base,
			start: at(2026, 11, 30),
			end: at(2026, 11, 30) + HOUR_MS,
			repeat: 'monthly',
			monthlyBy: 'weekday',
		});
		expect(last).toMatchObject({ ordinal: -1 });
	});

	it('refuses an ordinal that does not fit the start date', () => {
		const store = open();
		expect(
			store.create({ ...base, repeat: 'monthly', monthlyBy: 'weekday', ordinal: 2 }),
		).toBeNull();
		expect(store.list()).toEqual([]);
	});

	it('keeps the date rule by default and ignores weekday fields for other repeats', () => {
		const store = open();
		const monthly = store.create({ ...base, repeat: 'monthly' });
		expect(monthly?.monthlyBy).toBeUndefined();
		const yearly = store.create({ ...base, repeat: 'yearly', monthlyBy: 'weekday', ordinal: 3 });
		expect(yearly).toMatchObject({ repeat: 'yearly' });
		expect(yearly?.monthlyBy).toBeUndefined();
	});

	it('voids exceptions when the monthly pattern changes, and re-derives the ordinal', () => {
		const store = open();
		const m = store.create({ ...base, repeat: 'monthly', monthlyBy: 'weekday', ordinal: 3 })!;
		expect(store.cancelOccurrence(m.id, at(2026, 11, 17))).toBe(true);
		expect(store.get(m.id)?.exceptions).toHaveLength(1);
		const moved = store.update(m.id, { start: at(2026, 10, 27), end: at(2026, 10, 27) + HOUR_MS });
		expect(moved).toMatchObject({ ordinal: 4 });
		expect(moved?.exceptions).toBeUndefined();
		const date = store.update(m.id, { monthlyBy: 'date' });
		expect(date?.monthlyBy).toBeUndefined();
		expect(date?.repeat).toBe('monthly');
	});

	it('cancels an occurrence only when it is on the series', () => {
		const store = open();
		const m = store.create({
			...base,
			start: at(2026, 1, 31),
			end: at(2026, 1, 31) + HOUR_MS,
			repeat: 'monthly',
		})!;
		expect(store.cancelOccurrence(m.id, at(2026, 2, 28))).toBe(false);
		expect(store.cancelOccurrence(m.id, at(2026, 3, 31))).toBe(true);
	});

	it('falls back to a fitting ordinal when a stored row has a wrong one', () => {
		const doc = new Y.Doc();
		const store = createMeetingStore(doc, { id: 'ada', name: 'Ada' }, () => 1);
		const m = store.create({ ...base, repeat: 'monthly', monthlyBy: 'weekday', ordinal: 3 })!;
		const row = doc.getMap<Y.Map<unknown>>('teams:meetings').get(m.id)!;
		row.set('ordinal', 2);
		expect(store.get(m.id)?.ordinal).toBe(3);
		row.set('ordinal', 99);
		expect(store.get(m.id)?.ordinal).toBe(3);
	});
});
