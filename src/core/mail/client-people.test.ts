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
});
