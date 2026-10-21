// @vitest-environment jsdom
import { zonedToUtc, type CalendarEvent } from 'ooxml-core/calendar';
import { defineMailCalendar, type MailCalendar } from './calendar-pane';

type Updating = HTMLElement & { updateComplete: Promise<boolean> };

beforeAll(() => defineMailCalendar());
afterEach(() => {
	document.body.replaceChildren();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const ZONE = 'Europe/Berlin';
const at = (month: number, day: number, hour = 0, minute = 0): number =>
	zonedToUtc({ year: 2026, month, day, hour, minute }, ZONE);
const NOW = at(10, 15, 11); // Thursday, 15 October 2026, 11:00 in Berlin (UTC+2)
const event = (
	over: Partial<CalendarEvent> & Pick<CalendarEvent, 'id' | 'start' | 'end'>,
): CalendarEvent => ({ title: over.id, description: '', zone: ZONE, repeat: 'none', ...over });

const grid = (el: MailCalendar) => el.shadowRoot!.querySelector('mail-calendar-grid') as Updating;
async function settle(el: MailCalendar): Promise<void> {
	for (let i = 0; i < 3; i++) {
		await el.updateComplete;
		await grid(el).updateComplete;
	}
}
async function mount(events: CalendarEvent[] = [], locale = 'en'): Promise<MailCalendar> {
	const el = document.createElement('mail-calendar') as MailCalendar;
	el.zone = ZONE;
	el.now = NOW;
	el.locale = locale;
	el.events = events;
	document.body.append(el);
	await settle(el);
	return el;
}
const inGrid = <T extends Element = HTMLElement>(el: MailCalendar, selector: string): T[] => [
	...grid(el).shadowRoot!.querySelectorAll<T>(selector),
];
const text = (value: string | null | undefined): string =>
	(value ?? '').replace(/\s+/gu, ' ').trim();
/** A button by its accessible name (its label, else its text), in the grid or in the pane. */
function button(el: MailCalendar, name: string): HTMLButtonElement {
	const all = [
		...grid(el).shadowRoot!.querySelectorAll<HTMLButtonElement>('button'),
		...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('button'),
	];
	const found = all.find((b) => text(b.getAttribute('aria-label') ?? b.textContent) === name);
	if (!found) throw new Error(`no button ${name}`);
	return found;
}
async function click(el: MailCalendar, name: string): Promise<void> {
	button(el, name).click();
	await settle(el);
}
const range = (el: MailCalendar) => text(inGrid(el, '.range')[0]!.textContent);
const dialog = (el: MailCalendar) => el.shadowRoot!.querySelector<HTMLElement>('.event-dialog');
const field = (el: MailCalendar, name: string) =>
	el.shadowRoot!.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
/** Type into the dialog like a person: a value, then its change event, one field at a time. */
async function fill(el: MailCalendar, values: Record<string, string>): Promise<void> {
	for (const [name, value] of Object.entries(values)) {
		const input = field(el, name);
		input.value = value;
		input.dispatchEvent(new Event('change', { bubbles: true }));
		await settle(el);
	}
}
function record(el: MailCalendar, type: string): unknown[] {
	const seen: unknown[] = [];
	el.addEventListener(type, (e) => seen.push((e as CustomEvent).detail));
	return seen;
}

const review = event({ id: 'review', title: 'Review', start: at(10, 15, 10), end: at(10, 15, 11) });
const holiday = event({
	id: 'holiday',
	title: 'Holiday',
	allDay: true,
	start: at(10, 16),
	end: at(10, 17),
});
const standup = event({
	id: 'standup',
	title: 'Stand-up',
	start: at(10, 5, 9, 30),
	end: at(10, 5, 9, 45),
	repeat: 'weekly',
});

describe('<mail-calendar>', () => {
	it('shows the events of the week, of one day and of the month', async () => {
		const el = await mount([review, holiday, standup]);
		expect(range(el)).toMatch(/^October 12\D+18, 2026$/u);
		const columns = inGrid(el, '.column');
		expect(columns).toHaveLength(7);
		expect(text(columns[3]!.querySelector('.event')!.getAttribute('aria-label'))).toBe(
			'Review, 10:00 AM - 11:00 AM',
		);
		expect(columns[0]!.querySelector('.event-title')!.textContent).toBe('Stand-up');
		expect(text(inGrid(el, '.allday-label')[0]!.textContent)).toBe('All day');
		expect(inGrid(el, '.head')[4]!.querySelector('.chip')!.textContent).toBe('Holiday');
		await click(el, 'Day');
		expect(inGrid(el, '.column')).toHaveLength(1);
		expect(range(el)).toBe('Thursday, October 15, 2026');
		await click(el, 'Month');
		expect(range(el)).toBe('October 2026');
		expect(inGrid(el, '.day')).toHaveLength(42);
		const chips = inGrid(el, '.chip').map((c) => text(c.textContent));
		expect(chips.filter((c) => c.endsWith('Stand-up'))).toHaveLength(5);
		expect(chips).toContain('10:00 AMReview');
		expect(chips).toContain('Holiday');
	});

	it('steps with previous and next, and Today comes back', async () => {
		const el = await mount();
		await click(el, 'Next week');
		expect(range(el)).toMatch(/^October 19\D+25, 2026$/u);
		await click(el, 'Month');
		await click(el, 'Next month');
		expect(range(el)).toBe('November 2026');
		await click(el, 'Previous month');
		await click(el, 'Previous month');
		expect(range(el)).toBe('September 2026');
		await click(el, 'Today');
		expect(range(el)).toBe('October 2026');
	});

	it('creates an event at wall-clock times in the calendar zone', async () => {
		const el = await mount();
		const saved = record(el, 'mail-save-event');
		await click(el, 'New event');
		expect(text(dialog(el)!.querySelector('h2')!.textContent)).toBe('New event');
		expect(el.shadowRoot!.activeElement).toBe(field(el, 'title'));
		// The next half hour of today is proposed.
		expect([field(el, 'startDate').value, field(el, 'startTime').value]).toEqual([
			'2026-10-15',
			'11:30',
		]);
		expect([field(el, 'endDate').value, field(el, 'endTime').value]).toEqual([
			'2026-10-15',
			'12:00',
		]);
		await fill(el, { title: 'Planning', startDate: '2026-10-20', startTime: '09:00' });
		// Moving the start keeps the length.
		expect([field(el, 'endDate').value, field(el, 'endTime').value]).toEqual([
			'2026-10-20',
			'09:30',
		]);
		await fill(el, { endTime: '10:30', location: ' Room 4 ' });
		await click(el, 'Save');
		expect(dialog(el)).toBeNull();
		expect(saved).toHaveLength(1);
		const created = (saved[0] as { event: CalendarEvent }).event;
		expect(created).toEqual({
			id: expect.any(String),
			title: 'Planning',
			description: '',
			location: 'Room 4',
			start: Date.UTC(2026, 9, 20, 7),
			end: Date.UTC(2026, 9, 20, 8, 30),
			zone: ZONE,
			repeat: 'none',
		});
		expect(created.id).not.toBe('');
		// After the clocks change, the same wall time is an hour later in UTC.
		await click(el, 'New event');
		await fill(el, {
			title: 'Winter',
			startDate: '2026-11-02',
			startTime: '09:00',
			endTime: '10:00',
		});
		await click(el, 'Save');
		const winter = (saved[1] as { event: CalendarEvent }).event;
		expect([winter.start, winter.end]).toEqual([
			Date.UTC(2026, 10, 2, 8),
			Date.UTC(2026, 10, 2, 9),
		]);
	});

	it('creates an all-day event whose stored end is the day after its last day', async () => {
		const el = await mount();
		const saved = record(el, 'mail-save-event');
		await click(el, 'New event');
		field(el, 'allDay').click();
		await settle(el);
		expect(field(el, 'startTime').closest('label')!.hidden).toBe(true);
		expect(field(el, 'endTime').closest('label')!.hidden).toBe(true);
		await fill(el, { title: 'Conference', startDate: '2026-10-20', endDate: '2026-10-21' });
		await click(el, 'Save');
		expect((saved[0] as { event: CalendarEvent }).event).toMatchObject({
			title: 'Conference',
			allDay: true,
			start: Date.UTC(2026, 9, 19, 22),
			end: Date.UTC(2026, 9, 21, 22),
			zone: ZONE,
		});
	});

	it('proposes an all-day event on a free part of a month day', async () => {
		const el = await mount();
		await click(el, 'Month');
		const day = inGrid(el, '.day').find(
			(d) => d.getAttribute('aria-label') === 'Thursday, October 22',
		)!;
		day.click();
		await settle(el);
		expect(field(el, 'allDay').checked).toBe(true);
		expect([field(el, 'startDate').value, field(el, 'endDate').value]).toEqual([
			'2026-10-22',
			'2026-10-22',
		]);
	});

	it('says what is missing and saves nothing until it is fixed', async () => {
		const el = await mount();
		const saved = record(el, 'mail-save-event');
		await click(el, 'New event');
		await click(el, 'Save');
		const issue = () => text(el.shadowRoot!.querySelector('.issue')?.textContent);
		expect(issue()).toBe('Add a title.');
		expect(field(el, 'title').getAttribute('aria-invalid')).toBe('true');
		expect(field(el, 'title').getAttribute('aria-describedby')).toBe('event-issue');
		await fill(el, { title: 'Backwards', startDate: '2026-10-20', endDate: '2026-10-19' });
		await click(el, 'Save');
		expect(issue()).toBe('The end cannot be before the start.');
		expect(field(el, 'endDate').getAttribute('aria-invalid')).toBe('true');
		expect(el.shadowRoot!.activeElement).toBe(field(el, 'endDate'));
		await fill(el, { endDate: '' });
		await click(el, 'Save');
		expect(issue()).toBe('Enter a valid start and end.');
		expect(saved).toEqual([]);
		expect(dialog(el)).not.toBeNull();
	});

	it('edits, exports and deletes an event opened from the grid', async () => {
		const el = await mount([review]);
		const saved = record(el, 'mail-save-event');
		const exported = record(el, 'mail-export-ics');
		const deleted = record(el, 'mail-delete-event');
		const leaked = record(el, 'mail-calendar-open');
		inGrid<HTMLButtonElement>(el, '.event')[0]!.click();
		await settle(el);
		expect(leaked).toEqual([]);
		expect(text(dialog(el)!.querySelector('h2')!.textContent)).toBe('Edit event');
		expect([
			field(el, 'title').value,
			field(el, 'startTime').value,
			field(el, 'endTime').value,
		]).toEqual(['Review', '10:00', '11:00']);
		await fill(el, { title: 'Review v2' });
		await click(el, 'Save');
		expect(saved).toEqual([{ event: { ...review, title: 'Review v2' } }]);
		inGrid<HTMLButtonElement>(el, '.event')[0]!.click();
		await settle(el);
		await click(el, 'Export as .ics');
		expect(exported).toEqual([{ ids: ['review'] }]);
		const confirm = vi.fn(() => false);
		vi.stubGlobal('confirm', confirm);
		await click(el, 'Delete');
		expect(confirm).toHaveBeenCalledWith('Delete Review?');
		expect(deleted).toEqual([]);
		confirm.mockReturnValue(true);
		await click(el, 'Delete');
		expect(deleted).toEqual([{ id: 'review' }]);
		expect(dialog(el)).toBeNull();
	});

	it('edits a repeating event as a whole series', async () => {
		const series = {
			...standup,
			count: 10,
			exceptions: [{ originalStart: at(10, 19, 9, 30), cancelled: true }],
		};
		const el = await mount([series]);
		const saved = record(el, 'mail-save-event');
		inGrid<HTMLButtonElement>(el, '.event')[0]!.click();
		await settle(el);
		expect(text(dialog(el)!.textContent)).toContain('Changes apply to every event in the series.');
		expect([field(el, 'startDate').value, field(el, 'repeat').value]).toEqual([
			'2026-10-05',
			'weekly',
		]);
		await fill(el, { title: 'Daily stand-up', repeat: 'daily' });
		await click(el, 'Save');
		// A new repeat keeps the end of the series but not the occurrences of the old one.
		const changed = (saved[0] as { event: CalendarEvent }).event;
		expect(changed).toMatchObject({
			id: 'standup',
			repeat: 'daily',
			count: 10,
			start: standup.start,
		});
		expect(changed.exceptions).toBeUndefined();
		el.events = [series];
		await settle(el);
		inGrid<HTMLButtonElement>(el, '.event')[0]!.click();
		await settle(el);
		await fill(el, { title: 'Stand-up!' });
		await click(el, 'Save');
		expect((saved[1] as { event: CalendarEvent }).event.exceptions).toEqual(series.exceptions);
	});

	it('closes the dialog with Escape and gives the focus back', async () => {
		const el = await mount();
		const opener = button(el, 'New event');
		opener.focus();
		await click(el, 'New event');
		const title = field(el, 'title');
		title.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
		);
		await settle(el);
		expect(dialog(el)).toBeNull();
		expect(grid(el).shadowRoot!.activeElement).toBe(opener);
	});

	it('keeps Tab and Shift+Tab inside the dialog', async () => {
		const el = await mount();
		await click(el, 'New event');
		const close = button(el, 'Close');
		const cancel = button(el, 'Cancel');
		const tab = (from: HTMLElement, shiftKey = false): KeyboardEvent => {
			const event = new KeyboardEvent('keydown', {
				key: 'Tab',
				shiftKey,
				bubbles: true,
				composed: true,
				cancelable: true,
			});
			from.dispatchEvent(event);
			return event;
		};
		cancel.focus();
		expect(tab(cancel).defaultPrevented).toBe(true);
		expect(el.shadowRoot!.activeElement).toBe(close);
		expect(tab(close, true).defaultPrevented).toBe(true);
		expect(el.shadowRoot!.activeElement).toBe(cancel);
		field(el, 'title').focus();
		expect(tab(field(el, 'title')).defaultPrevented).toBe(false);
	});

	it('imports .ics files and exports the whole calendar', async () => {
		const el = await mount([review]);
		const imported = record(el, 'mail-import-ics');
		const exported = record(el, 'mail-export-ics');
		const input = el.shadowRoot!.querySelector<HTMLInputElement>('input.file')!;
		expect(input.accept).toBe('.ics,text/calendar');
		const pick = vi.spyOn(input, 'click').mockImplementation(() => undefined);
		await click(el, 'Import');
		expect(pick).toHaveBeenCalledTimes(1);
		const files = [
			new File(['BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'], 'a.ics', { type: 'text/calendar' }),
			new File(['BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'], 'b.ics'),
		];
		Object.defineProperty(input, 'files', { configurable: true, value: files });
		input.dispatchEvent(new Event('change'));
		await vi.waitFor(() => expect(imported).toHaveLength(2));
		expect(imported[0]).toEqual({ text: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' });
		await click(el, 'Export');
		expect(exported).toEqual([{}]);
		el.events = [];
		await settle(el);
		expect(button(el, 'Export').disabled).toBe(true);
	});

	it('speaks the display locale and follows a change of it', async () => {
		const el = await mount([], 'de');
		expect(range(el)).toMatch(/Oktober/u);
		for (const name of [
			'Heute',
			'Tag',
			'Woche',
			'Monat',
			'Neuer Termin',
			'Importieren',
			'Exportieren',
		])
			expect(button(el, name)).toBeTruthy();
		expect(button(el, 'Woche').getAttribute('aria-pressed')).toBe('true');
		expect(grid(el).getAttribute('aria-label')).toBe('Kalender');
		el.locale = 'fr';
		await settle(el);
		expect(range(el)).toMatch(/octobre/u);
		expect(button(el, 'Nouvel événement')).toBeTruthy();
	});
});
