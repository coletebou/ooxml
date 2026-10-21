// @vitest-environment jsdom
import { render } from 'lit';
import { zonedToUtc, type CalendarEvent } from 'ooxml-core/calendar';
import { draftOf } from '../calendar/event-draft';
import { eventDialog, type EventDialogHandlers } from './event-dialog';
import { mailI18n } from './i18n/translator';

const ZONE = 'Europe/Berlin';
const NEW_YORK = 'America/New_York';
const at = (month: number, day: number, hour = 0): number =>
	zonedToUtc({ year: 2026, month, day, hour }, ZONE);
const handlers: EventDialogHandlers = {
	change() {},
	save() {},
	cancel() {},
	remove() {},
	exportEvent() {},
};

/** The dialog for `series` with its start moved past its end, as Save leaves it. */
function refused(series: CalendarEvent, zone: string, locale: string): HTMLElement {
	const container = document.createElement('div');
	const draft = { ...draftOf(series, zone), startDate: '2026-11-25', endDate: '2026-11-25' };
	render(eventDialog(draft, 'series', zone, mailI18n(locale), handlers), container);
	return container;
}

describe('eventDialog', () => {
	it('names the day a series ends on when its start moves past it', () => {
		// Every Tuesday at 9:00 in Berlin up to 24 November.
		const series: CalendarEvent = {
			id: 'weekly',
			title: 'Weekly',
			description: '',
			zone: ZONE,
			repeat: 'weekly',
			start: at(10, 6, 9),
			end: at(10, 6, 10),
			until: at(11, 24, 9),
		};
		const dialog = refused(series, ZONE, 'en');
		expect(dialog.querySelector('.issue')?.textContent).toBe(
			'This series ends on November 24, 2026. Pick a start on or before that day.',
		);
		const start = dialog.querySelector('[name="startDate"]')!;
		expect([start.getAttribute('aria-invalid'), start.getAttribute('aria-describedby')]).toEqual([
			'true',
			'event-issue',
		]);
		expect(refused(series, ZONE, 'de').querySelector('.issue')?.textContent).toBe(
			'Diese Serie endet am 24. November 2026. Wählen Sie einen Beginn an diesem Tag oder davor.',
		);
		// The day is the one the form shows: 1:00 in Berlin is the evening before in New York.
		const early = { ...series, start: at(10, 6, 1), end: at(10, 6, 2), until: at(11, 24, 1) };
		expect(refused(early, NEW_YORK, 'en').querySelector('.issue')?.textContent).toContain(
			'November 23, 2026',
		);
	});
});
