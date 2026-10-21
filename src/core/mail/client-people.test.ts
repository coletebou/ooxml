import type { CalendarEvent } from '../calendar/model';
import { createMemoryCalendarStore } from './calendar-store';
import { createMailClient } from './client';
import { createMemoryTransport } from './memory-transport';
import { until } from './test-support/client';

const STAND_UP: CalendarEvent = {
	id: 'stand-up',
	title: 'Stand-up',
	description: 'Ten minutes',
	zone: 'Europe/Berlin',
	start: Date.UTC(2026, 9, 21, 7),
	end: Date.UTC(2026, 9, 21, 7, 10),
	repeat: 'weekly',
	count: 4,
};

describe('the calendar actions', () => {
	it('recognises its own events when an exported calendar is imported again', async () => {
		const client = createMailClient({
			transport: createMemoryTransport(),
			calendar: createMemoryCalendarStore({ seed: [STAND_UP] }),
		});
		await until(client, (s) => s.events.length === 1);
		const text = client.exportIcs();
		expect(text).toContain('UID:stand-up@');
		expect(await client.importIcs(text, 'Europe/Berlin')).toBe(1);
		expect(client.getState().events).toEqual([STAND_UP]);
		client.destroy();
	});

	it('keeps what an earlier import brought when another file without UIDs comes in', async () => {
		const client = createMailClient({
			transport: createMemoryTransport(),
			calendar: createMemoryCalendarStore(),
		});
		const file = (title: string, ...lines: string[]): string =>
			[
				'BEGIN:VCALENDAR',
				'VERSION:2.0',
				'BEGIN:VEVENT',
				...lines,
				`SUMMARY:${title}`,
				'DTSTART:20261020T090000Z',
				'END:VEVENT',
				'END:VCALENDAR',
			].join('\r\n');
		const titles = () => client.getState().events.map((event) => event.title);
		expect(await client.importIcs(file('First'))).toBe(1);
		expect(await client.importIcs(file('Second'))).toBe(1);
		expect(titles()).toEqual(['First', 'Second']);
		// An event with a UID is still the same event when it comes in again.
		await client.importIcs(file('Review', 'UID:review@example.com'));
		await client.importIcs(file('Review, moved', 'UID:review@example.com'));
		expect(titles()).toEqual(['First', 'Second', 'Review, moved']);
		client.destroy();
	});

	it('adds an occurrence changed on its own to the series it holds, never replacing the series', async () => {
		const client = createMailClient({
			transport: createMemoryTransport(),
			calendar: createMemoryCalendarStore({ seed: [STAND_UP] }),
		});
		await until(client, (s) => s.events.length === 1);
		const file = (uid: string, ...lines: string[]): string =>
			[
				'BEGIN:VCALENDAR',
				'VERSION:2.0',
				'BEGIN:VEVENT',
				`UID:${uid}`,
				'SUMMARY:Review',
				...lines,
				'END:VEVENT',
				'END:VCALENDAR',
			].join('\r\n');
		const week = (n: number): number => Date.UTC(2026, 9, 20 + 7 * n, 9);
		expect(
			await client.importIcs(
				file('review@example.com', 'DTSTART:20261020T090000Z', 'RRULE:FREQ=WEEKLY;COUNT=4'),
			),
		).toBe(1);
		// The way an update to one occurrence comes: that occurrence alone, moved or cancelled.
		const moved = ['RECURRENCE-ID:20261027T090000Z', 'DTSTART:20261028T140000Z'];
		expect(await client.importIcs(file('review@example.com', 'SEQUENCE:1', ...moved))).toBe(1);
		const cancelled = ['RECURRENCE-ID:20261103T090000Z', 'DTSTART:20261103T090000Z'];
		await client.importIcs(file('review@example.com', ...cancelled, 'STATUS:CANCELLED'));
		// Of an event this client exported, too (at 09:00 in Berlin, 08:00 UTC after the clocks change).
		const own = ['RECURRENCE-ID:20261028T080000Z', 'DTSTART:20261028T090000Z'];
		await client.importIcs(file('stand-up@ooxml-mail.invalid', ...own));
		const events = client.getState().events;
		expect(events.map((e) => [e.id, e.repeat])).toEqual([
			['review@example.com', 'weekly'],
			['stand-up', 'weekly'],
		]);
		expect(events[0]?.exceptions).toEqual([
			{
				originalStart: week(1),
				cancelled: false,
				start: Date.UTC(2026, 9, 28, 14),
				end: Date.UTC(2026, 9, 28, 14),
			},
			{ originalStart: week(2), cancelled: true },
		]);
		expect(events[1]?.exceptions).toEqual([
			{
				originalStart: Date.UTC(2026, 9, 28, 8),
				cancelled: false,
				start: Date.UTC(2026, 9, 28, 9),
				end: Date.UTC(2026, 9, 28, 9),
				title: 'Review',
				description: '',
			},
		]);
		// An occurrence of a series the calendar does not hold stands beside the others.
		await client.importIcs(file('other@example.com', ...moved));
		expect(client.getState().events.map((e) => e.id)).toEqual([
			'review@example.com',
			'stand-up',
			'other@example.com-20261027T090000Z',
		]);
		client.destroy();
	});

	it('never replaces a stored event with one from another program whose UID is its id', async () => {
		const client = createMailClient({
			transport: createMemoryTransport(),
			calendar: createMemoryCalendarStore({ seed: [STAND_UP] }),
		});
		await until(client, (s) => s.events.length === 1);
		const file = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'BEGIN:VEVENT',
			'UID:stand-up',
			'SUMMARY:Another program',
			'DTSTART:20261020T090000Z',
			'END:VEVENT',
			'END:VCALENDAR',
		].join('\r\n');
		expect(await client.importIcs(file)).toBe(1);
		// The calendar's own event stays as it was; the other one stands beside it, its UID kept.
		const others = () => client.getState().events.filter((event) => event.id !== 'stand-up');
		expect(client.getState().events.find((event) => event.id === 'stand-up')).toEqual(STAND_UP);
		expect(others()).toMatchObject([{ title: 'Another program', uid: 'stand-up' }]);
		// Imported again, it is that same event, not a copy.
		expect(await client.importIcs(file)).toBe(1);
		expect(others()).toHaveLength(1);
		expect(client.getState().events).toHaveLength(2);
		client.destroy();
	});
});
