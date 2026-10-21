// The calendar view the product UIs share: a time grid for one day, the work week or the week (all-
// day events under each day's heading) and a month grid, in the viewer's zone, with Today, previous
// and next, the view switch and a New button, plus an `actions` slot for a product's own buttons.
// A product subclasses it and supplies the events, the modes it offers, its wording, its icons and
// what an activation does (the abstract hooks below), so Teams keeps its meeting calendar under its
// own tag and dictionaries and Mail adds a month view. Moved from `teams/calendar-view.ts`; the
// month grid, the all-day row, the hooks and the slot are new.
import { html, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';
import {
	type CalendarDay,
	type CalendarMode,
	type MonthDay,
	type Occurrence,
	DAY_MS,
	localZone,
	monthGrid as monthDays,
	occurrencesBetween,
	shiftAnchor,
	startOfDay,
	viewDays,
	zonedParts,
	zonedToUtc,
} from 'ooxml-core/calendar';
import type { MessageParams } from 'ooxml-core/i18n';
import { OfficeElement } from '../base';
import { inheritLocale, LOCALE_HOST, pushLocale, type LocaleHost } from '../i18n/locale-host';
import { rangeText } from './format';
import { monthGrid } from './month-grid';
import { timeGrid } from './time-grid';
import type {
	CalendarGlyph,
	CalendarGridItem,
	CalendarLabel,
	GridContext,
	ShownOccurrence,
} from './types';
import gridCss from './calendar-grid.css?raw';
import monthCss from './calendar-month.css?raw';

export type * from './types';

/** The view's stylesheet; a product adds it before its own (its look sets the `--_` helpers). */
export const CALENDAR_GRID_CSS = `${gridCss}\n${monthCss}`;

const FIRST_VISIBLE_HOUR = 8;
const SLOT_MINUTES = 30;

/**
 * The shared calendar view. Properties: `zone` (IANA, this device's by default), `now` (the clock,
 * for tests; 0 reads the real one), `mode` (one of `modes()`), `locale` (inherited from the
 * enclosing product element when empty). Subclasses provide the hooks; the view dispatches nothing
 * itself, so each product keeps its own event names and details.
 */
export abstract class CalendarGridView<
	E extends CalendarGridItem = CalendarGridItem,
> extends OfficeElement {
	static override syncUpdates = false;
	/** The mode a view opens in; a narrow screen opens the day view instead. */
	static defaultMode: CalendarMode = 'week';
	static override properties: PropertyDeclarations = {
		locale: { type: String },
		zone: { type: String },
		now: { type: Number },
		mode: { type: String, reflect: true },
		anchor: { state: true },
		tick: { state: true },
	};
	/** A BCP 47 tag (`de`, `zh-CN`); empty inherits the enclosing product element's, else English. */
	declare locale: string;
	declare zone: string;
	declare now: number;
	declare mode: CalendarMode;
	/** A moment of the shown period; in the month grid, the selected day. */
	declare anchor: number;
	declare tick: number;
	private timer: ReturnType<typeof setInterval> | undefined;
	private scrolledFor: Element | null = null;
	private resize: ResizeObserver | undefined;

	constructor() {
		super();
		this.locale = '';
		this.zone = localZone();
		this.now = 0;
		this.mode = (this.constructor as typeof CalendarGridView).defaultMode;
		this.anchor = 0;
		this.tick = 0;
	}

	/** The modes the view switch offers, in order. */
	protected abstract modes(): readonly CalendarMode[];
	/** The events to show. */
	protected abstract items(): readonly E[];
	/** The wording of the view, from the product's dictionaries. */
	protected abstract label(key: CalendarLabel, params?: MessageParams): string;
	/** The locale `Intl` formats dates and times in; undefined keeps the browser's. */
	protected abstract intlLocale(): string | undefined;
	/** The icon of a bar button. */
	protected abstract glyph(kind: CalendarGlyph): TemplateResult | string;
	/** An event's occurrence was activated (clicked, or Enter or Space on it). */
	protected abstract openOccurrence(item: E, occurrence: Occurrence): void;
	/**
	 * A new event is proposed: at `start`, all day when `allDay`. The New button passes 0, which
	 * leaves the time to the product (`suggestedStart()` is one answer).
	 */
	protected abstract proposeEvent(start: number, allDay: boolean): void;
	/** The person switched the view. */
	protected modeChanged(_mode: CalendarMode): void {}
	/** The first day of the week: 0 = Sunday, Monday by default. */
	protected weekStartsOn(): number {
		return 1;
	}

	get [LOCALE_HOST](): true {
		return true;
	}

	private clock(): number {
		return this.now || Date.now();
	}

	/** The next half hour when the shown day is today, else 9:00 on the shown day. */
	protected suggestedStart(): number {
		const now = this.clock();
		const shown = this.anchor || now;
		const day = zonedParts(shown, this.zone);
		if (startOfDay(shown, this.zone) !== startOfDay(now, this.zone))
			return zonedToUtc({ year: day.year, month: day.month, day: day.day, hour: 9 }, this.zone);
		const clock = zonedParts(now, this.zone);
		const minute = (Math.floor((clock.hour * 60 + clock.minute) / SLOT_MINUTES) + 1) * SLOT_MINUTES;
		return zonedToUtc({ year: day.year, month: day.month, day: day.day, minute }, this.zone);
	}

	override connectedCallback(): void {
		super.connectedCallback();
		inheritLocale(this as unknown as LocaleHost);
		this.setAttribute('role', 'region');
		if (!this.anchor) this.anchor = this.clock();
		// A phone opens on the day view, like the Teams mobile calendar.
		const opening = (this.constructor as typeof CalendarGridView).defaultMode;
		if (
			globalThis.matchMedia?.('(max-width: 40em)').matches &&
			this.mode === opening &&
			this.modes().includes('day')
		)
			this.mode = 'day';
		this.timer = setInterval(() => (this.tick = this.clock()), 60_000);
		// A phone shows a list first, so the grid may get its size long after it first rendered.
		if (typeof ResizeObserver !== 'undefined') {
			this.resize = new ResizeObserver(() => this.scrollToWorkday());
			this.resize.observe(this);
		}
	}

	override disconnectedCallback(): void {
		clearInterval(this.timer);
		this.resize?.disconnect();
		super.disconnectedCallback();
	}

	protected override willUpdate(changed: PropertyValues<this>): void {
		if (changed.has('now') && this.now && changed.get('now') === 0) this.anchor = this.now;
	}

	protected override update(changed: PropertyValues): void {
		super.update(changed);
		this.setAttribute('aria-label', this.label('title'));
		if (changed.has('locale')) pushLocale(this as unknown as LocaleHost);
	}

	protected override updated(): void {
		this.scrollToWorkday();
	}

	/** Start the day at 8:00 once a time grid has a size (again for a new one, after the month). */
	private scrollToWorkday(): void {
		const scroller = this.renderRoot.querySelector<HTMLElement>('.scroller');
		if (!scroller || scroller === this.scrolledFor || scroller.clientHeight === 0) return;
		scroller.scrollTop = (scroller.scrollHeight / 24) * FIRST_VISIBLE_HOUR;
		this.scrolledFor = scroller;
	}

	private setMode(mode: CalendarMode): void {
		this.mode = mode;
		this.modeChanged(mode);
	}

	private step(direction: -1 | 1): void {
		this.anchor = shiftAnchor(this.anchor || this.clock(), this.mode, direction, this.zone);
	}

	/** Show one day: the day view when the product offers it. */
	private showDay(day: CalendarDay): void {
		this.anchor = day.start;
		if (this.mode !== 'day' && this.modes().includes('day')) this.setMode('day');
	}

	/** Select a day of the month grid and give its number the focus once it is drawn. */
	private selectDay(anchor: number): void {
		this.anchor = anchor;
		void this.updateComplete.then(() =>
			this.renderRoot.querySelector<HTMLElement>('.date[tabindex="0"]')?.focus(),
		);
	}

	/** The occurrences of the items around `days` (a day either side, for all-day dates). */
	private shown(days: readonly CalendarDay[]): ShownOccurrence<E>[] {
		const from = days[0]!.start - DAY_MS;
		const to = days[days.length - 1]!.end + DAY_MS;
		return this.items().flatMap((item) =>
			occurrencesBetween(item, from, to).map((occurrence) => ({ ...occurrence, item })),
		);
	}

	private context(now: number, anchor: number): GridContext<E> {
		return {
			zone: this.zone,
			now,
			anchor,
			intl: this.intlLocale(),
			weekStartsOn: this.weekStartsOn(),
			label: (key, params) => this.label(key, params),
			open: (item, occurrence) => this.openOccurrence(item, occurrence),
			propose: (start, allDay) => this.proposeEvent(start, allDay),
			showDay: (day) => this.showDay(day),
			select: (next) => this.selectDay(next),
		};
	}

	protected override render() {
		const now = this.clock();
		const anchor = this.anchor || now;
		const weeks: MonthDay[][] | null =
			this.mode === 'month' ? monthDays(anchor, this.zone, this.weekStartsOn()) : null;
		const days = weeks ? weeks.flat() : viewDays(anchor, this.mode, this.zone, this.weekStartsOn());
		const view = this.context(now, anchor);
		const shown = this.shown(days);
		return html`${this.bar(days, anchor)}${weeks ? monthGrid(view, weeks, shown) : timeGrid(view, days, shown)}`;
	}

	private bar(days: readonly CalendarDay[], anchor: number) {
		const unit = this.mode === 'day' ? 'day' : this.mode === 'month' ? 'month' : 'week';
		return html`<div class="bar">
			<h2 class="range" aria-live="polite"
				>${rangeText(days, this.mode, anchor, this.zone, this.intlLocale())}</h2
			>
			<button type="button" class="today" @click=${() => (this.anchor = this.clock())}
				>${this.label('today')}</button
			>
			<button
				type="button"
				class="step"
				aria-label=${this.label(`previous.${unit}`)}
				@click=${() => this.step(-1)}
				>${this.glyph('previous')}</button
			>
			<button
				type="button"
				class="step next"
				aria-label=${this.label(`next.${unit}`)}
				@click=${() => this.step(1)}
				>${this.glyph('next')}</button
			>
			<div class="modes" role="group" aria-label=${this.label('viewLabel')}
				>${this.modes().map(
					(mode) =>
						html`<button
							type="button"
							aria-pressed=${String(this.mode === mode)}
							@click=${() => this.setMode(mode)}
							>${this.label(`mode.${mode}`)}</button
						>`,
				)}</div
			>
			<button type="button" class="new" @click=${() => this.proposeEvent(0, false)}
				>${this.glyph('new')}${this.label('new')}</button
			>
			<slot name="actions"></slot>
		</div>`;
	}
}
