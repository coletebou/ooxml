// @vitest-environment jsdom
import { html, unsafeCSS } from 'lit';
import { type CalendarMode, type Occurrence, zonedToUtc } from 'ooxml-core/calendar';
import type { MessageParams } from 'ooxml-core/i18n';
import {
	CALENDAR_GRID_CSS,
	CalendarGridView,
	type CalendarGlyph,
	type CalendarGridItem,
	type CalendarLabel,
} from './calendar-grid';
import { LocaleLitElement } from '../i18n/locale-element';
import { MONTH_DAY_EVENTS } from './month-grid';

const WORDS: Record<CalendarLabel, string> = {
	title: 'Calendar',
	today: 'Today',
	viewLabel: 'View',
	new: 'New',
	'mode.workweek': 'Work week',
	'mode.week': 'Week',
	'mode.day': 'Day',
	'mode.month': 'Month',
	'previous.day': 'Previous day',
	'previous.week': 'Previous week',
	'previous.month': 'Previous month',
	'next.day': 'Next day',
	'next.week': 'Next week',
	'next.month': 'Next month',
	allDay: 'All day',
	more: '+{count} more',
	openDay: 'Open {date}',
	untitled: 'Untitled',
};

/** A product of the shared view: English words, the day, week and month views, calls recorded. */
class TestGrid extends CalendarGridView {
	static override styles = unsafeCSS(CALENDAR_GRID_CSS);
	static override properties = { events: { attribute: false } };
	declare events: CalendarGridItem[];
	readonly calls: unknown[][] = [];

	constructor() {
		super();
		this.events = [];
	}
	suggest(): number {
		return this.suggestedStart();
	}
	protected override modes(): readonly CalendarMode[] {
		return ['day', 'week', 'month'];
	}
	protected override items(): readonly CalendarGridItem[] {
		return this.events;
	}
	protected override label(key: CalendarLabel, params?: MessageParams): string {
		return WORDS[key].replace(/\{(\w+)\}/gu, (_, name: string) => String(params?.[name] ?? ''));
	}
	protected override intlLocale(): string {
		return 'en';
	}
	protected override glyph(kind: CalendarGlyph): string {
		return kind;
	}
	protected override openOccurrence(item: CalendarGridItem, occurrence: Occurrence): void {
		this.calls.push(['open', item.id, occurrence.start]);
	}
	protected override proposeEvent(start: number, allDay: boolean): void {
		this.calls.push(['new', start, allDay]);
	}
	protected override modeChanged(mode: CalendarMode): void {
		this.calls.push(['mode', mode]);
	}
}

/** A product element around the view, which hands its locale down to it. */
class GridHost extends LocaleLitElement {
	override render() {
		return html`<test-calendar-grid></test-calendar-grid>`;
	}
}

beforeAll(() => {
	if (!customElements.get('test-calendar-grid'))
		customElements.define('test-calendar-grid', TestGrid);
	if (!customElements.get('test-calendar-grid-host'))
		customElements.define('test-calendar-grid-host', GridHost);
});
afterEach(() => {
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});

const ZONE = 'Europe/Berlin';
const at = (month: number, day: number, hour = 0, minute = 0): number =>
	zonedToUtc({ year: 2026, month, day, hour, minute }, ZONE);
const NOW = at(10, 15, 11); // Thursday, 15 October 2026
const item = (
	over: Partial<CalendarGridItem> & Pick<CalendarGridItem, 'id' | 'start' | 'end'>,
): CalendarGridItem => ({ title: over.id, description: '', zone: ZONE, repeat: 'none', ...over });

async function mount(events: CalendarGridItem[], mode?: CalendarMode): Promise<TestGrid> {
	const el = document.createElement('test-calendar-grid') as TestGrid;
	el.zone = ZONE;
	el.now = NOW;
	if (mode) el.mode = mode;
	el.events = events;
	document.body.append(el);
	await el.updateComplete;
	return el;
}
const qa = <T extends Element = HTMLElement>(el: TestGrid, selector: string): T[] => [
	...el.shadowRoot!.querySelectorAll<T>(selector),
];
const range = (el: TestGrid) => el.shadowRoot!.querySelector('.range')!.textContent;
/** Text with every run of whitespace (ICU writes a narrow no-break space before AM) as one space. */
const text = (value: string | null | undefined): string => (value ?? '').replace(/\s+/gu, ' ');
const named = (el: TestGrid, name: string) =>
	qa<HTMLButtonElement>(el, 'button').find((b) => b.getAttribute('aria-label') === name)!;
/** The month grid's day cell of a date in October 2026 (the grid starts on Monday 28 September). */
const october = (el: TestGrid, day: number) => qa(el, '.day')[day + 2]!;
async function press(el: TestGrid, key: string): Promise<void> {
	const focused = el.shadowRoot!.activeElement as HTMLElement;
	focused.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true }));
	await el.updateComplete;
	await el.updateComplete;
}

describe('the shared calendar view: month grid', () => {
	it('lays out six weeks from Monday with the month, today and the selected day marked', async () => {
		const el = await mount([], 'month');
		expect(range(el)).toBe('October 2026');
		expect(qa(el, '.weekday').map((d) => d.textContent)).toEqual([
			'Mon',
			'Tue',
			'Wed',
			'Thu',
			'Fri',
			'Sat',
			'Sun',
		]);
		const days = qa(el, '.day');
		expect(days).toHaveLength(42);
		const dates = qa(el, '.date').map((d) => d.textContent);
		expect(dates.slice(0, 5)).toEqual(['28', '29', '30', 'Oct 1', '2']);
		expect(dates.at(-1)).toBe('8');
		expect(dates).toContain('Nov 1');
		const outside = days.map((d) => d.dataset.outside === 'true');
		expect(outside.filter(Boolean)).toHaveLength(11);
		expect(outside.slice(3, 34).every((o) => !o)).toBe(true);
		const today = october(el, 15);
		expect(today.getAttribute('aria-label')).toBe('Thursday, October 15');
		const date = today.querySelector('.date')!;
		expect(date.getAttribute('aria-current')).toBe('date');
		expect(date.getAttribute('aria-label')).toBe('Open Thursday, October 15');
		expect(qa(el, '[aria-current="date"]')).toHaveLength(1);
		expect(today.dataset.selected).toBe('true');
		const stops = qa(el, '.date[tabindex="0"]');
		expect(stops).toHaveLength(1);
		expect(stops[0]).toBe(date);
		expect(el.getAttribute('role')).toBe('region');
		expect(el.getAttribute('aria-label')).toBe('Calendar');
	});

	it('shows all-day, multi-day and repeating events on every day they touch', async () => {
		const el = await mount(
			[
				item({ id: 'trip', allDay: true, start: at(10, 20), end: at(10, 23) }),
				item({ id: 'night', start: at(10, 9, 22), end: at(10, 10, 2) }),
				item({ id: 'standup', start: at(10, 5, 9, 30), end: at(10, 5, 9, 45), repeat: 'weekly' }),
				item({ id: 'early', start: at(10, 20, 8), end: at(10, 20, 9) }),
			],
			'month',
		);
		const chips = (day: number) =>
			[...october(el, day).querySelectorAll<HTMLElement>('.chip')].map((c) => text(c.textContent));
		expect([20, 21, 22, 23].map((d) => chips(d).includes('trip'))).toEqual([
			true,
			true,
			true,
			false,
		]);
		expect(october(el, 20).querySelector<HTMLElement>('.chip')!.dataset.allDay).toBe('true');
		expect(chips(9)).toEqual(['10:00 PMnight']);
		expect(chips(10)).toEqual(['night']);
		expect(qa(el, '.chip').filter((c) => c.textContent!.endsWith('standup'))).toHaveLength(5);
		expect(chips(26)).toEqual(['9:30 AMstandup']);
		// A day lists its all-day events first, then the rest by start.
		expect(chips(20)).toEqual(['trip', '8:00 AMearly']);
		const trip = october(el, 21).querySelector('.chip')!;
		expect(trip.getAttribute('aria-label')).toBe('trip, All day');
		const night = october(el, 9).querySelector('.chip')!;
		expect(text(night.getAttribute('aria-label'))).toBe('night, 10:00 PM - 2:00 AM');
	});

	it('shows the first events of a full day and a +N more that opens the day', async () => {
		const many = Array.from({ length: 5 }, (_, i) =>
			item({ id: `m${i}`, start: at(10, 14, 8 + i), end: at(10, 14, 9 + i) }),
		);
		const three = Array.from({ length: MONTH_DAY_EVENTS }, (_, i) =>
			item({ id: `t${i}`, start: at(10, 21, 8 + i), end: at(10, 21, 9 + i) }),
		);
		const el = await mount([...many, ...three], 'month');
		expect(october(el, 14).querySelectorAll('.chip')).toHaveLength(MONTH_DAY_EVENTS - 1);
		const more = october(el, 14).querySelector<HTMLButtonElement>('.more')!;
		expect(more.textContent).toBe(`+${5 - MONTH_DAY_EVENTS + 1} more`);
		expect(october(el, 21).querySelectorAll('.chip')).toHaveLength(MONTH_DAY_EVENTS);
		expect(october(el, 21).querySelector('.more')).toBeNull();
		more.click();
		await el.updateComplete;
		expect(el.mode).toBe('day');
		expect(el.calls).toEqual([['mode', 'day']]);
		expect(range(el)).toBe('Wednesday, October 14, 2026');
		expect(qa(el, '.column .event')).toHaveLength(5);
	});

	it('opens a day from its number, proposes an all-day event on a free part and opens events', async () => {
		const el = await mount(
			[item({ id: 'review', start: at(10, 22, 10), end: at(10, 22, 11) })],
			'month',
		);
		october(el, 22).click();
		october(el, 22).querySelector<HTMLButtonElement>('.chip')!.click();
		expect(el.calls).toEqual([
			['new', at(10, 22), true],
			['open', 'review', at(10, 22, 10)],
		]);
		october(el, 22).querySelector<HTMLButtonElement>('.date')!.click();
		await el.updateComplete;
		expect(el.mode).toBe('day');
		expect(range(el)).toBe('Thursday, October 22, 2026');
	});

	it('moves the selected day with the arrow keys, Home, End and the page keys', async () => {
		const el = await mount([], 'month');
		el.shadowRoot!.querySelector<HTMLButtonElement>('.date[tabindex="0"]')!.focus();
		await press(el, 'ArrowRight');
		const focusedText = () =>
			(el.shadowRoot!.activeElement as HTMLElement).getAttribute('aria-label');
		expect(focusedText()).toBe('Open Friday, October 16');
		await press(el, 'ArrowDown');
		expect(focusedText()).toBe('Open Friday, October 23');
		await press(el, 'PageDown');
		expect(range(el)).toBe('November 2026');
		expect(focusedText()).toBe('Open Monday, November 23');
		await press(el, 'End');
		expect(focusedText()).toBe('Open Sunday, November 29');
		await press(el, 'Home');
		expect(focusedText()).toBe('Open Monday, November 23');
		await press(el, 'ArrowUp');
		await press(el, 'ArrowLeft');
		expect(focusedText()).toBe('Open Sunday, November 15');
		expect(qa(el, '.date[tabindex="0"]')).toHaveLength(1);
		await press(el, 'PageUp');
		expect(range(el)).toBe('October 2026');
	});

	it('steps a month with previous and next and comes back with Today', async () => {
		const el = await mount([], 'month');
		named(el, 'Next month').click();
		await el.updateComplete;
		expect(range(el)).toBe('November 2026');
		named(el, 'Previous month').click();
		await el.updateComplete;
		named(el, 'Previous month').click();
		await el.updateComplete;
		expect(range(el)).toBe('September 2026');
		el.shadowRoot!.querySelector<HTMLButtonElement>('.today')!.click();
		await el.updateComplete;
		expect(range(el)).toBe('October 2026');
		const modes = qa<HTMLButtonElement>(el, '.modes button');
		expect(modes.map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
			['Day', 'false'],
			['Week', 'false'],
			['Month', 'true'],
		]);
		expect(el.shadowRoot!.querySelector('.modes')!.getAttribute('aria-label')).toBe('View');
	});
});

describe('the shared calendar view: time grid', () => {
	it('puts all-day events under the day headings and keeps timed ones in the columns', async () => {
		const el = await mount(
			[
				item({ id: 'trip', allDay: true, start: at(10, 20), end: at(10, 23) }),
				item({ id: 'review', start: at(10, 21, 10), end: at(10, 21, 11) }),
			],
			'week',
		);
		expect(el.shadowRoot!.querySelector('.allday-label')).toBeNull();
		expect(qa(el, '.allday')).toHaveLength(0);
		named(el, 'Next week').click();
		await el.updateComplete;
		expect(el.shadowRoot!.querySelector('.allday-label')!.textContent).toBe('All day');
		const heads = qa(el, '.head');
		expect(heads.map((h) => h.querySelectorAll('.chip').length)).toEqual([0, 1, 1, 1, 0, 0, 0]);
		expect(heads[1]!.querySelector('.allday')!.getAttribute('aria-label')).toBe(
			'Tuesday, October 20, All day',
		);
		const columns = qa(el, '.column');
		expect(columns.map((c) => c.querySelectorAll('.event').length)).toEqual([0, 0, 1, 0, 0, 0, 0]);
		expect(text(columns[2]!.querySelector('.event')!.getAttribute('aria-label'))).toBe(
			'review, 10:00 AM - 11:00 AM',
		);
	});

	it('suggests the next half hour today and 9:00 on another day', async () => {
		const el = await mount([], 'day');
		expect(el.suggest()).toBe(at(10, 15, 11, 30));
		named(el, 'Next day').click();
		await el.updateComplete;
		expect(el.suggest()).toBe(at(10, 16, 9));
		el.shadowRoot!.querySelector<HTMLButtonElement>('.new')!.click();
		expect(el.calls).toEqual([['new', 0, false]]);
	});

	it('proposes the half hour a click points at, the last one at the foot of the column', async () => {
		const el = await mount([], 'day');
		const column = qa(el, '.column')[0]!;
		column.getBoundingClientRect = () => ({ top: 100, height: 960, bottom: 1060 }) as DOMRect;
		const click = (clientY: number) =>
			column.dispatchEvent(new MouseEvent('click', { clientY, bubbles: true, composed: true }));
		click(580);
		click(1060);
		expect(el.calls).toEqual([
			['new', at(10, 15, 12), false],
			['new', at(10, 15, 23, 30), false],
		]);
	});

	it('opens a phone on the day view unless a mode was chosen', async () => {
		vi.stubGlobal('matchMedia', () => ({ matches: true }));
		expect((await mount([])).mode).toBe('day');
		expect((await mount([], 'month')).mode).toBe('month');
	});
});

describe('the shared calendar view: locale', () => {
	it('keeps a locale set on it while its host changes, and follows the host once it is cleared', async () => {
		const host = document.createElement('test-calendar-grid-host') as GridHost;
		host.locale = 'de';
		document.body.append(host);
		await host.updateComplete;
		const grid = host.shadowRoot!.querySelector('test-calendar-grid') as TestGrid;
		await grid.updateComplete;
		expect(grid.locale).toBe('de');
		const change = async (el: GridHost | TestGrid, locale: string): Promise<string> => {
			el.locale = locale;
			await host.updateComplete;
			await grid.updateComplete;
			return grid.locale;
		};
		expect(await change(grid, 'de')).toBe('de');
		expect(await change(host, 'fr')).toBe('de');
		expect(await change(grid, '')).toBe('fr');
		expect(await change(host, 'es')).toBe('es');
	});
});
