// The types the shared calendar view (`calendar-grid.ts`) and its time and month grids share: what
// the view reads of an event, the wording and icons it asks its product for, and the view state the
// grid templates read. New code.
import type { CalendarDay, CalendarEvent, CalendarMode, Occurrence } from 'ooxml-core/calendar';
import type { MessageParams } from 'ooxml-core/i18n';

/** What the view reads of an event: the calendar model plus the flags a product may set. */
export interface CalendarGridItem extends CalendarEvent {
	/** Happening now (a meeting call in progress): drawn in the live colour. */
	live?: boolean;
	/** The viewer's own (they organised it): drawn with the own-item fill. */
	mine?: boolean;
}

/** The period previous and next step by. */
export type CalendarUnit = 'day' | 'week' | 'month';

/**
 * Every piece of wording the view asks its product for (`CalendarGridView.label`). `title` names the
 * view's region, `viewLabel` the view switch and `new` the New button; `more` is the "+N more" of a
 * full month day (with `count`), `openDay` names a month day's number button (with `date`), and
 * `untitled` stands in for an empty title.
 */
export type CalendarLabel =
	| 'title'
	| 'today'
	| 'viewLabel'
	| 'new'
	| `mode.${CalendarMode}`
	| `previous.${CalendarUnit}`
	| `next.${CalendarUnit}`
	| 'allDay'
	| 'more'
	| 'openDay'
	| 'untitled';

/** The icons of the bar: previous, next and the New button's. */
export type CalendarGlyph = 'previous' | 'next' | 'new';

/** An occurrence on screen with the item it belongs to. */
export interface ShownOccurrence<E extends CalendarGridItem = CalendarGridItem> extends Occurrence {
	item: E;
}

/** What the time and month grids read of the view, and the actions they call back. */
export interface GridContext<E extends CalendarGridItem = CalendarGridItem> {
	zone: string;
	/** The clock, UTC milliseconds. */
	now: number;
	/** A moment of the shown period: in the month grid, the selected day. */
	anchor: number;
	/** The locale `Intl` formats in; undefined keeps the browser's. */
	intl: string | undefined;
	/** 0 = Sunday. */
	weekStartsOn: number;
	label(key: CalendarLabel, params?: MessageParams): string;
	/** An event was activated. */
	open(item: E, occurrence: Occurrence): void;
	/** A new event is proposed at `start`, all day when `allDay`. */
	propose(start: number, allDay: boolean): void;
	/** Show one day in the day view. */
	showDay(day: CalendarDay): void;
	/** Select another day of the month grid and move the keyboard focus to it. */
	select(anchor: number): void;
}
