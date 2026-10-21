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
		// Moving the start drops the occurrences of the old series and the old weekday ordinal.
		const moved = built(buildEvent({ ...draft, startTime: '10:00', endTime: '11:00' }, BERLIN, id));
		expect(moved).toMatchObject({ repeat: 'monthly', monthlyBy: 'weekday', count: 5 });
		expect(moved).not.toHaveProperty('exceptions');
		expect(moved).not.toHaveProperty('ordinal');
		const weekly = built(buildEvent({ ...draft, repeat: 'weekly' }, BERLIN, id));
		expect(weekly).toMatchObject({ repeat: 'weekly', count: 5 });
		expect(weekly).not.toHaveProperty('monthlyBy');
		expect(weekly).not.toHaveProperty('exceptions');
		const once = built(buildEvent({ ...draft, repeat: 'none' }, BERLIN, id));
		for (const key of ['monthlyBy', 'ordinal', 'count', 'until', 'exceptions'])
			expect(once, key).not.toHaveProperty(key);
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
