import type { CalendarEvent } from '../calendar/model';
import { occurrencesBetween } from '../calendar/occurrences';
import { DAY_MS, HOUR_MS } from '../calendar/time-zone';
import { sanitizeEvent } from './calendar-store';

const T0 = Date.UTC(2026, 9, 15, 13);
const event: CalendarEvent = {
	id: 'e1',
	title: 'Review',
	description: '',
	zone: 'America/New_York',
	start: T0,
	end: T0 + HOUR_MS,
	repeat: 'none',
};

describe('sanitizeEvent', () => {
	it('keeps every field of a stored event as it was', () => {
		const full: CalendarEvent = {
			...event,
			description: 'Notes',
			location: 'Room 1',
			allDay: false,
			repeat: 'monthly',
			monthlyBy: 'weekday',
			ordinal: -1,
			count: 5,
			nominalDays: 1,
			exceptions: [
				{ originalStart: T0 + 28 * DAY_MS, cancelled: true },
				{
					originalStart: T0 + 35 * DAY_MS,
					cancelled: false,
					start: T0 + 36 * DAY_MS,
					end: T0 + 36 * DAY_MS + HOUR_MS,
					title: 'Moved',
					description: 'A day later',
				},
			],
			cancelled: false,
			reminder: 15,
			organizer: { name: 'Ada', email: 'ada@example.com' },
			attendees: [
				{ name: 'Sam', email: 'sam@example.com', response: 'accepted', optional: true },
				{ name: 'Lee' },
			],
			uid: 'review@example.com',
		};
		expect(sanitizeEvent(full)).toEqual(full);
		expect(sanitizeEvent({ ...event, repeat: 'daily', until: T0 + 7 * DAY_MS })).toEqual({
			...event,
			repeat: 'daily',
			until: T0 + 7 * DAY_MS,
		});
	});

	it('drops a record whose times no calendar can hold', () => {
		for (const times of [
			{ start: Number.NaN },
			{ end: T0 - 1 },
			{ end: 9e15 },
			{ start: -9e15 },
			{ start: '2026-10-15' },
		])
			expect(sanitizeEvent({ ...event, ...times }), JSON.stringify(times)).toBeNull();
	});

	it('keeps an event in a zone this browser does not know in UTC, as the importer does', () => {
		expect(sanitizeEvent({ ...event, zone: 'Not/A_Zone' })).toEqual({ ...event, zone: 'UTC' });
	});

	it('leaves out what a damaged record holds in the wrong shape, keeping the event', () => {
		const damaged = {
			...event,
			repeat: 'fortnightly',
			monthlyBy: 'moon',
			ordinal: 7,
			count: -2,
			until: 'soon',
			nominalDays: Number.POSITIVE_INFINITY,
			exceptions: 'none',
			cancelled: 'no',
			reminder: 'x',
			organizer: 'Ada',
			attendees: [{ name: 5 }, null, { name: 'Sam', response: 'maybe', optional: 'yes' }],
			location: 7,
			allDay: 'yes',
			uid: {},
			extra: 'kept by nothing',
		};
		expect(sanitizeEvent(damaged)).toEqual({ ...event, attendees: [{ name: 'Sam' }] });
		const exceptions = [
			{ originalStart: 'then', cancelled: true },
			{ originalStart: T0 + DAY_MS, cancelled: 'yes', start: 9e15, title: 3 },
			{ originalStart: T0 + 2 * DAY_MS, cancelled: true },
		];
		expect(sanitizeEvent({ ...event, repeat: 'daily', exceptions })?.exceptions).toEqual([
			{ originalStart: T0 + DAY_MS, cancelled: false },
			{ originalStart: T0 + 2 * DAY_MS, cancelled: true },
		]);
	});

	it('gives a calendar it can show, whatever a record held', () => {
		const values = [undefined, null, -1, 0, 1.5, 9e15, Number.NaN, '', 'x', {}, [], true];
		for (const field of ['repeat', 'monthlyBy', 'ordinal', 'count', 'until', 'nominalDays'])
			for (const value of values) {
				const kept = sanitizeEvent({ ...event, repeat: 'weekly', [field]: value });
				expect(
					() => occurrencesBetween(kept!, T0 - DAY_MS, T0 + 400 * DAY_MS),
					field,
				).not.toThrow();
			}
	});
});
