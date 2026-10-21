import { zonedToUtc, type CalendarEvent } from 'ooxml-core/calendar';
import { buildEvent, draftOf, keepLength, newDraft } from './event-draft';
import { dateValue, daysBetween, fromInputs, parseDate, shiftDate, timeValue } from './zoned-input';

const BERLIN = 'Europe/Berlin';
const NEW_YORK = 'America/New_York';
const at = (zone: string, month: number, day: number, hour = 0, minute = 0): number =>
	zonedToUtc({ year: 2026, month, day, hour, minute }, zone);
const event = (
	over: Partial<CalendarEvent> & Pick<CalendarEvent, 'start' | 'end'>,
): CalendarEvent => ({
	id: 'e1',
	title: 'Event',
	description: '',
	zone: BERLIN,
	repeat: 'none',
	...over,
});
const id = () => 'new-id';
const built = (result: ReturnType<typeof buildEvent>): CalendarEvent => {
	if (!('event' in result)) throw new Error(`not built: ${result.issue}`);
	return result.event;
};

describe('zoned input values', () => {
	it('reads and writes wall-clock values in a zone, across the clock change', () => {
		const summer = at(BERLIN, 10, 20, 9, 5);
		expect([dateValue(summer, BERLIN), timeValue(summer, BERLIN)]).toEqual(['2026-10-20', '09:05']);
		expect([dateValue(summer, NEW_YORK), timeValue(summer, NEW_YORK)]).toEqual([
			'2026-10-20',
			'03:05',
		]);
		expect(fromInputs('2026-10-20', '09:00', BERLIN)).toBe(Date.UTC(2026, 9, 20, 7));
		expect(fromInputs('2026-11-02', '09:00', BERLIN)).toBe(Date.UTC(2026, 10, 2, 8));
		expect(fromInputs('2026-10-20', '', BERLIN)).toBe(Date.UTC(2026, 9, 19, 22));
		// 02:30 on the morning clocks go forward does not exist: it moves to 03:30 summer time.
		expect(fromInputs('2026-03-29', '02:30', BERLIN)).toBe(Date.UTC(2026, 2, 29, 1, 30));
	});

	it('rejects values that are not a date or a time', () => {
		for (const [date, time] of [
			['2026-02-30', '09:00'],
			['', '09:00'],
			['2026-10-20', '25:00'],
			['2026-10-20', '9am'],
			['20-10-2026', ''],
		])
			expect(fromInputs(date!, time!, BERLIN), `${date} ${time}`).toBeNull();
		expect(parseDate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
		expect(parseDate('2026-02-29')).toBeNull();
	});

	it('steps and counts whole days of date values', () => {
		expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
		expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
		expect(shiftDate('nonsense', 1)).toBe('');
		expect(daysBetween('2026-10-20', '2026-10-23')).toBe(3);
		expect(daysBetween('2026-10-20', '')).toBeNull();
	});
});

describe('event drafts', () => {
	it('drafts a new event: half an hour, or a whole day with 9:00 ready for timed', () => {
		expect(newDraft(at(BERLIN, 10, 20, 14), false, BERLIN)).toMatchObject({
			original: null,
			allDay: false,
			startDate: '2026-10-20',
			startTime: '14:00',
			endDate: '2026-10-20',
			endTime: '14:30',
			repeat: 'none',
		});
		expect(newDraft(at(BERLIN, 10, 20), true, BERLIN)).toMatchObject({
			allDay: true,
			startDate: '2026-10-20',
			endDate: '2026-10-20',
			startTime: '09:00',
		});
	});

	it('ends a new event that runs past midnight on the next day, ready to save', () => {
		const late = newDraft(at(BERLIN, 10, 20, 23, 30), false, BERLIN);
		expect([late.startDate, late.startTime, late.endDate, late.endTime]).toEqual([
			'2026-10-20',
			'23:30',
			'2026-10-21',
			'00:00',
		]);
		const saved = built(buildEvent({ ...late, title: 'Late call' }, BERLIN, id));
		expect(saved.end - saved.start).toBe(30 * 60_000);
		// A whole day still ends on the day it starts (its last day).
		expect(newDraft(at(BERLIN, 10, 20, 23, 30), true, BERLIN).endDate).toBe('2026-10-20');
	});

	it('shows a timed event in the calendar zone and saves it back unchanged', () => {
		const stored = event({
			zone: NEW_YORK,
			start: at(NEW_YORK, 10, 20, 9),
			end: at(NEW_YORK, 10, 20, 10),
		});
		const draft = draftOf(stored, BERLIN);
		expect([draft.startDate, draft.startTime, draft.endTime]).toEqual([
			'2026-10-20',
			'15:00',
			'16:00',
		]);
		// The event keeps its own zone, where a repeat keeps its time.
		expect(built(buildEvent(draft, BERLIN, id))).toEqual(stored);
	});

	it('shows an all-day event on its own dates with its last day as the end', () => {
		const stored = event({ allDay: true, start: at(BERLIN, 10, 20), end: at(BERLIN, 10, 23) });
		const draft = draftOf(stored, NEW_YORK);
		expect([draft.startDate, draft.endDate, draft.allDay]).toEqual([
			'2026-10-20',
			'2026-10-22',
			true,
		]);
		expect(built(buildEvent(draft, NEW_YORK, id))).toEqual(stored);
		// A one-day event ends on the day it starts.
		const one = draftOf(
			event({ allDay: true, start: at(BERLIN, 10, 20), end: at(BERLIN, 10, 21) }),
			BERLIN,
		);
		expect(one.endDate).toBe('2026-10-20');
	});

	it('names what keeps a draft from being saved', () => {
		const draft = newDraft(at(BERLIN, 10, 20, 9), false, BERLIN);
		expect(buildEvent({ ...draft, title: '  ' }, BERLIN, id)).toEqual({ issue: 'title' });
		expect(buildEvent({ ...draft, title: 'A', endTime: '' }, BERLIN, id)).toEqual({
			issue: 'when',
		});
		expect(buildEvent({ ...draft, title: 'A', endTime: '08:59' }, BERLIN, id)).toEqual({
			issue: 'order',
		});
		const allDay = { ...newDraft(at(BERLIN, 10, 20), true, BERLIN), title: 'A' };
		expect(buildEvent({ ...allDay, endDate: '2026-10-19' }, BERLIN, id)).toEqual({
			issue: 'order',
		});
		// An event without length is allowed.
		expect(built(buildEvent({ ...draft, title: 'A', endTime: '09:00' }, BERLIN, id)).end).toBe(
			at(BERLIN, 10, 20, 9),
		);
	});

	it('trims the title and the place and keeps what the dialog does not show', () => {
		const stored = event({
			start: at(BERLIN, 10, 20, 9),
			end: at(BERLIN, 10, 20, 10),
			location: 'Old room',
			uid: 'abc@example.invalid',
			reminder: 15,
			attendees: [{ name: 'Ada', email: 'ada@example.invalid' }],
		});
		const saved = built(
			buildEvent({ ...draftOf(stored, BERLIN), title: ' New ', location: '  ' }, BERLIN, id),
		);
		expect(saved.title).toBe('New');
		expect(saved).not.toHaveProperty('location');
		expect(saved).toMatchObject({
			id: 'e1',
			uid: stored.uid,
			reminder: 15,
			attendees: stored.attendees,
		});
		const fresh = built(
			buildEvent({ ...newDraft(stored.start, false, BERLIN), title: 'X' }, BERLIN, id),
		);
		expect(fresh.id).toBe('new-id');
		expect(fresh).not.toHaveProperty('allDay');
	});

	it('keeps a series end and its exceptions only while the series keeps its shape', () => {
		const stored = event({
			start: at(BERLIN, 10, 6, 9),
			end: at(BERLIN, 10, 6, 10),
			repeat: 'monthly',
			monthlyBy: 'weekday',
			ordinal: 1,
			count: 5,
			exceptions: [{ originalStart: at(BERLIN, 11, 3, 9), cancelled: true }],
		});
		const draft = draftOf(stored, BERLIN);
		expect(built(buildEvent({ ...draft, title: 'Renamed' }, BERLIN, id))).toEqual({
			...stored,
			title: 'Renamed',
		});
		// Moving the start drops the occurrences of the old series; a new time keeps the weekday
		// ordinal, which still fits the date (6 October is the first Tuesday).
		const moved = built(buildEvent({ ...draft, startTime: '10:00', endTime: '11:00' }, BERLIN, id));
		expect(moved).toMatchObject({ repeat: 'monthly', monthlyBy: 'weekday', count: 5, ordinal: 1 });
		expect(moved).not.toHaveProperty('exceptions');
		// A date it no longer fits (13 October is the second Tuesday) drops it.
		const later = built(
			buildEvent({ ...draft, startDate: '2026-10-13', endDate: '2026-10-13' }, BERLIN, id),
		);
		expect(later).toMatchObject({ repeat: 'monthly', monthlyBy: 'weekday', count: 5 });
		expect(later).not.toHaveProperty('ordinal');
		const weekly = built(buildEvent({ ...draft, repeat: 'weekly' }, BERLIN, id));
		expect(weekly).toMatchObject({ repeat: 'weekly', count: 5 });
		expect(weekly).not.toHaveProperty('monthlyBy');
		expect(weekly).not.toHaveProperty('exceptions');
		const once = built(buildEvent({ ...draft, repeat: 'none' }, BERLIN, id));
		for (const key of ['monthlyBy', 'ordinal', 'count', 'until', 'exceptions'])
			expect(once, key).not.toHaveProperty(key);
	});

	it('keeps the seconds of a start and an end the form leaves as they were', () => {
		// An imported event can start between whole minutes, which the time fields do not show.
		const stored = event({
			start: at(BERLIN, 10, 6, 9) + 30_000,
			end: at(BERLIN, 10, 6, 10) + 45_000,
			repeat: 'weekly',
			exceptions: [{ originalStart: at(BERLIN, 10, 13, 9) + 30_000, cancelled: true }],
		});
		const draft = draftOf(stored, BERLIN);
		expect([draft.startTime, draft.endTime]).toEqual(['09:00', '10:00']);
		expect(built(buildEvent({ ...draft, title: 'Renamed' }, BERLIN, id))).toEqual({
			...stored,
			title: 'Renamed',
		});
		// A new end leaves the start, and the series, as they were; a new start is the minute it names.
		const longer = built(buildEvent({ ...draft, endTime: '11:00' }, BERLIN, id));
		expect([longer.start, longer.end]).toEqual([stored.start, at(BERLIN, 10, 6, 11)]);
		expect(longer.exceptions).toEqual(stored.exceptions);
		const moved = built(buildEvent({ ...draft, startTime: '09:15', endTime: '10:15' }, BERLIN, id));
		expect([moved.start, moved.end]).toEqual([at(BERLIN, 10, 6, 9, 15), at(BERLIN, 10, 6, 10, 15)]);
		// An end set to the minute the start shows is never before the start.
		expect(built(buildEvent({ ...draft, endTime: '09:00' }, BERLIN, id)).end).toBe(stored.start);
	});

	it('keeps a last-weekday series on the last weekday when only its time changes', () => {
		// 27 November 2026 is both the fourth and the last Friday: only the ordinal says which.
		const stored = event({
			start: at(BERLIN, 11, 27, 9),
			end: at(BERLIN, 11, 27, 10),
			repeat: 'monthly',
			monthlyBy: 'weekday',
			ordinal: -1,
		});
		const draft = draftOf(stored, BERLIN);
		const retimed = built(
			buildEvent({ ...draft, startTime: '10:00', endTime: '11:00' }, BERLIN, id),
		);
		expect(retimed).toMatchObject({ monthlyBy: 'weekday', ordinal: -1 });
		// 25 December is the last Friday too, so a move there keeps it.
		const december = built(
			buildEvent({ ...draft, startDate: '2026-12-25', endDate: '2026-12-25' }, BERLIN, id),
		);
		expect(december).toMatchObject({ ordinal: -1 });
	});

	it('moves the end with the start so the length stays', () => {
		const draft = newDraft(at(BERLIN, 10, 20, 9), false, BERLIN);
		const later = keepLength({ ...draft, startTime: '23:45' }, draft, BERLIN);
		expect([later.endDate, later.endTime]).toEqual(['2026-10-21', '00:15']);
		const days = { ...newDraft(at(BERLIN, 10, 20), true, BERLIN), endDate: '2026-10-22' };
		expect(keepLength({ ...days, startDate: '2026-10-30' }, days, BERLIN).endDate).toBe(
			'2026-11-01',
		);
		expect(keepLength({ ...draft, startDate: '' }, draft, BERLIN)).toEqual({
			...draft,
			startDate: '',
		});
	});
});
