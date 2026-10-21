import { parseIcs } from './ics-read';
import { eventsToIcs } from './ics-write';
import type { CalendarEvent } from './model';
import { occurrencesBetween } from './occurrences';
import { HOUR_MS, zonedToUtc } from './time-zone';

const NY = 'America/New_York';
const OPTIONS = {
	prodId: '-//Example//Calendar//EN',
	uidDomain: 'example.com',
	now: Date.UTC(2026, 0, 1),
};
const at = (zone: string, year: number, month: number, day: number, hour = 0, minute = 0): number =>
	zonedToUtc({ year, month, day, hour, minute }, zone);

const EVENTS: CalendarEvent[] = [
	{
		id: 'weekly',
		title: 'Plan; review, sign-off \\ "Q4"',
		description: 'Agenda:\n1. Status, blockers; risks\n\n2. Ünïcödé '.repeat(4),
		location: 'Room 4, floor 2',
		zone: NY,
		start: at(NY, 2026, 3, 2, 9),
		end: at(NY, 2026, 3, 2, 9, 30),
		repeat: 'weekly',
		count: 8,
		reminder: 15,
		organizer: { name: 'Ada Lovelace', email: 'ada@example.com' },
		attendees: [
			{ name: 'Doe, Jane', email: 'jane@example.com', response: 'accepted' },
			{
				name: 'Bob "the builder"',
				email: 'bob@example.com',
				optional: true,
				response: 'tentative',
			},
		],
		exceptions: [
			{ originalStart: at(NY, 2026, 3, 9, 9), cancelled: true },
			{
				originalStart: at(NY, 2026, 3, 16, 9),
				cancelled: false,
				start: at(NY, 2026, 3, 17, 14),
				end: at(NY, 2026, 3, 17, 15, 15),
				title: 'Moved to Tuesday',
				description: '',
			},
			{ originalStart: at(NY, 2026, 3, 23, 9), cancelled: false, title: 'Retro' },
		],
	},
	{
		id: 'last-friday',
		title: 'Review',
		description: '',
		zone: 'Europe/Berlin',
		start: at('Europe/Berlin', 2026, 10, 30, 16),
		end: at('Europe/Berlin', 2026, 10, 30, 17),
		repeat: 'monthly',
		monthlyBy: 'weekday',
		ordinal: -1,
		until: Date.UTC(2027, 5, 1, 3, 59, 59),
		exceptions: [
			{
				originalStart: at('Europe/Berlin', 2026, 12, 25, 16),
				cancelled: false,
				start: at('Europe/Berlin', 2026, 12, 18, 16),
				end: at('Europe/Berlin', 2026, 12, 18, 17),
			},
		],
	},
	{
		id: 'month-end',
		title: 'Close the books',
		description: 'Each 31st',
		zone: 'Asia/Tokyo',
		start: at('Asia/Tokyo', 2026, 1, 31, 18),
		end: at('Asia/Tokyo', 2026, 1, 31, 19),
		repeat: 'monthly',
		reminder: 0,
	},
	{
		id: 'anniversary',
		title: 'Anniversary',
		description: '',
		zone: 'UTC',
		start: Date.UTC(2026, 9, 15, 12),
		end: Date.UTC(2026, 9, 15, 13),
		repeat: 'yearly',
		reminder: 1440,
	},
	{
		id: 'trip',
		title: 'Trip',
		description: '',
		zone: NY,
		allDay: true,
		start: at(NY, 2026, 3, 6),
		end: at(NY, 2026, 3, 9),
		repeat: 'yearly',
		until: at(NY, 2029, 3, 6),
		exceptions: [
			{ originalStart: at(NY, 2027, 3, 6), cancelled: true },
			{
				originalStart: at(NY, 2028, 3, 6),
				cancelled: false,
				start: at(NY, 2028, 3, 10),
				end: at(NY, 2028, 3, 12),
				title: 'Trip (later)',
			},
		],
	},
	{
		id: 'abc-123@other.example',
		uid: 'abc-123@other.example',
		title: 'Imported and cancelled',
		description: 'Kept as it came',
		zone: 'Australia/Sydney',
		start: at('Australia/Sydney', 2026, 4, 5, 2, 30),
		end: at('Australia/Sydney', 2026, 4, 5, 3, 30),
		repeat: 'daily',
		count: 3,
		cancelled: true,
	},
	{
		id: 'reminder',
		title: 'Call',
		description: '',
		zone: 'Asia/Kolkata',
		start: at('Asia/Kolkata', 2026, 10, 15, 9, 45),
		end: at('Asia/Kolkata', 2026, 10, 15, 9, 45),
		repeat: 'none',
		reminder: 0.5,
	},
];

describe('iCalendar round trip', () => {
	const text = eventsToIcs(EVENTS, OPTIONS);
	const back = parseIcs(text, { zone: NY, uidDomain: 'example.com' });

	it('reads back every event as it was written', () => {
		expect(back.unsupported).toEqual([]);
		expect(back.events).toEqual(EVENTS);
	});

	it('shows the same occurrences after the trip', () => {
		for (const [i, event] of EVENTS.entries())
			expect(occurrencesBetween(back.events[i]!, 0, Date.UTC(2031, 0, 1))).toEqual(
				occurrencesBetween(event, 0, Date.UTC(2031, 0, 1)),
			);
	});

	it('writes the same text again', () => {
		expect(eventsToIcs(back.events, OPTIONS)).toBe(text);
		expect(back.events[0]!.end - back.events[0]!.start).toBe(HOUR_MS / 2);
	});
});
