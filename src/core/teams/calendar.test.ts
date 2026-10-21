import { parseIcs } from '../calendar/ics-read';
import {
	layoutDay,
	occurrenceAt,
	occurrencesBetween,
	remindersDue,
	shiftAnchor,
	viewDays,
} from './calendar';
import { icsFileName, meetingToIcs } from './ics';
import type { Meeting } from './meetings';
import { DAY_MS, zonedToUtc } from './time-zone';

// The occurrence, view and layout rules are the calendar area's and are tested with it
// (src/core/calendar); this file pins Teams' own shape of them and the meeting export.
const NY = 'America/New_York';
const meeting = (over: Partial<Meeting> = {}): Meeting => ({
	id: 'm1',
	title: 'Stand-up',
	description: '',
	organizerId: 'ada',
	organizerName: 'Ada',
	zone: NY,
	start: zonedToUtc({ year: 2026, month: 3, day: 5, hour: 9 }, NY),
	end: zonedToUtc({ year: 2026, month: 3, day: 5, hour: 9, minute: 30 }, NY),
	repeat: 'none',
	attendees: [],
	createdAt: 0,
	cancelled: false,
	...over,
});

describe('meeting occurrences', () => {
	it('name their meeting, with no fields beyond the Teams shape', () => {
		const first = meeting();
		const m = meeting({
			repeat: 'daily',
			exceptions: [{ originalStart: first.start + DAY_MS, cancelled: false, title: 'Moved' }],
		});
		expect(occurrencesBetween(m, m.start, m.start + 2 * DAY_MS)).toEqual([
			{
				key: `m1@${m.start}`,
				meetingId: 'm1',
				start: m.start,
				end: m.end,
				index: 0,
				recurrenceId: m.start,
			},
			{
				key: `m1@${m.start + DAY_MS}`,
				meetingId: 'm1',
				start: m.start + DAY_MS,
				end: m.end + DAY_MS,
				index: 1,
				recurrenceId: m.start + DAY_MS,
				changed: true,
				title: 'Moved',
			},
		]);
		expect(occurrenceAt(m, m.start + DAY_MS)?.meetingId).toBe('m1');
	});

	it('remind with their meeting', () => {
		const m = meeting({ repeat: 'daily' });
		const [due] = remindersDue([m], m.start - 60_000);
		expect(due?.meeting).toBe(m);
		expect(due?.occurrence).toEqual({
			key: `m1@${m.start}`,
			meetingId: 'm1',
			start: m.start,
			end: m.end,
			index: 0,
			recurrenceId: m.start,
		});
	});

	it('lay out in a Monday-based week', () => {
		const sunday = zonedToUtc({ year: 2026, month: 3, day: 8, hour: 12 }, NY);
		const week = viewDays(sunday, 'week', NY);
		expect(week.map((d) => d.day)).toEqual([2, 3, 4, 5, 6, 7, 8]);
		expect(viewDays(shiftAnchor(sunday, 'week', 1, NY), 'workweek', NY)[0]!.day).toBe(9);
		const m = meeting();
		const thursday = week[3]!;
		const [placed] = layoutDay(occurrencesBetween(m, thursday.start, thursday.end), thursday, NY);
		expect(placed).toMatchObject({ startMinute: 540, endMinute: 570, column: 0, columns: 1 });
		expect(placed?.occurrence.meetingId).toBe('m1');
	});
});

describe('ics', () => {
	it('exports a meeting with its repeat and a five minute alarm', () => {
		const text = meetingToIcs(
			meeting({
				repeat: 'weekly',
				description: 'Agenda, notes',
				attendees: [{ id: 'bob', name: 'Bob' }],
			}),
			{ now: Date.UTC(2026, 0, 1) },
		);
		expect(text.endsWith('\r\n')).toBe(true);
		expect(text.split('\r\n')).toEqual(
			expect.arrayContaining([
				'BEGIN:VCALENDAR',
				'UID:m1@openteams',
				'BEGIN:VTIMEZONE',
				'TZID:America/New_York',
				'DTSTART;TZID=America/New_York:20260305T090000',
				'DTEND;TZID=America/New_York:20260305T093000',
				'SUMMARY:Stand-up',
				'RRULE:FREQ=WEEKLY',
				'TRIGGER:-PT5M',
				'END:VCALENDAR',
			]),
		);
		expect(text).toContain('Agenda\\, notes');
		expect(text).toContain('Attendees: Bob');
		expect(icsFileName({ title: 'Q4 / plan: draft' })).toBe('Q4-plan-draft.ics');
		expect(icsFileName({ title: '' })).toBe('meeting.ics');
	});

	it('reads back with the shared iCalendar reader', () => {
		const skipped = zonedToUtc({ year: 2026, month: 3, day: 12, hour: 9 }, NY);
		const m = meeting({
			repeat: 'weekly',
			count: 4,
			exceptions: [{ originalStart: skipped, cancelled: true }],
		});
		const text = meetingToIcs(m, { now: 0, url: 'https://example.com/m1' });
		const { events, unsupported } = parseIcs(text, { uidDomain: 'openteams' });
		expect(events).toEqual([
			{
				id: 'm1',
				title: 'Stand-up',
				description: 'Organizer: Ada',
				zone: NY,
				start: m.start,
				end: m.end,
				repeat: 'weekly',
				count: 4,
				reminder: 5,
				exceptions: [{ originalStart: skipped, cancelled: true }],
			},
		]);
		expect(unsupported).toEqual(['URL is not imported']);
	});
});
