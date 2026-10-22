// The time grid of the day, work-week and week views: a sticky heading per day (its all-day events
// under it), the hours, and a column per day where timed events sit by their minutes after local
// midnight, overlapping ones side by side, with the current-time line on today. A click on a free
// slot proposes a new event at that half hour. Moved from `teams/calendar-view.ts`; the all-day row
// is new.
import { html, nothing } from 'lit';
import {
	type CalendarDay,
	type PlacedOccurrence,
	eventsByDay,
	layoutDay,
	minuteOfDay,
	startOfDay,
	zonedToUtc,
} from 'ooxml-core/calendar';
import { eventChip } from './chip';
import { dayName, eventTitle, hourLabel, timeRange, weekdayName } from './format';
import type { CalendarGridItem, GridContext, ShownOccurrence } from './types';

/** The slot length, in minutes, that new events snap to. */
export const SLOT_MINUTES = 30;

/** The grid of `days`; `shown` are the occurrences around them. */
export function timeGrid<E extends CalendarGridItem>(
	view: GridContext<E>,
	days: readonly CalendarDay[],
	shown: readonly ShownOccurrence<E>[],
) {
	const today = startOfDay(view.now, view.zone);
	const nowMinute = minuteOfDay(view.now, view.zone);
	const timed = shown.filter((o) => o.dates === undefined);
	const allDay = eventsByDay(
		shown.filter((o) => o.dates !== undefined),
		days,
		view.zone,
	);
	const anyAllDay = [...allDay.values()].some((list) => list.length > 0);
	return html`<div class="scroller">
		<div class="grid" style=${`--cols:${days.length}`}>
			<div class="corner"
				>${anyAllDay ? html`<span class="allday-label">${view.label('allDay')}</span>` : nothing}</div
			>
			${days.map((d) => dayHead(view, d, d.start === today, allDay.get(d.start) ?? []))}
			<div class="hours" aria-hidden="true"
				>${Array.from({ length: 24 }, (_, h) => html`<span>${hourLabel(h, view.intl)}</span>`)}</div
			>
			${days.map((d) => column(view, d, d.start === today, nowMinute, timed))}
		</div>
	</div>`;
}

function dayHead<E extends CalendarGridItem>(
	view: GridContext<E>,
	day: CalendarDay,
	today: boolean,
	allDay: readonly ShownOccurrence<E>[],
) {
	const row = allDay.length
		? html`<div
				class="allday"
				role="group"
				aria-label=${`${dayName(day, view.zone, view.intl)}, ${view.label('allDay')}`}
				>${allDay.map((o) => eventChip(view, o, day))}</div
			>`
		: nothing;
	return html`<div class="head" data-today=${String(today)}
		><span class="dow">${weekdayName(day.start, view.zone, view.intl)}</span
		><span class="dom">${day.day}</span>${row}</div
	>`;
}

function column<E extends CalendarGridItem>(
	view: GridContext<E>,
	day: CalendarDay,
	today: boolean,
	nowMinute: number,
	timed: readonly ShownOccurrence<E>[],
) {
	const now = today
		? html`<span
				class="now"
				style=${`--top:${(nowMinute / 1440) * 100}`}
				aria-hidden="true"
			></span>`
		: nothing;
	return html`<div
		class="column"
		role="group"
		aria-label=${dayName(day, view.zone, view.intl)}
		data-today=${String(today)}
		@click=${(event: MouseEvent) => {
			if (event.target === event.currentTarget) proposeAt(view, day, event);
		}}
		>${layoutDay(timed, day, view.zone).map((p) => timedEvent(view, p))}${now}</div
	>`;
}

function timedEvent<E extends CalendarGridItem>(
	view: GridContext<E>,
	placed: PlacedOccurrence<ShownOccurrence<E>>,
) {
	const occurrence = placed.occurrence;
	const title = eventTitle(view, occurrence);
	const time = timeRange(view, occurrence);
	const length = placed.endMinute - placed.startMinute;
	return html`<button
		type="button"
		class="event"
		data-live=${String(Boolean(occurrence.item.live))}
		data-mine=${String(Boolean(occurrence.item.mine))}
		data-short=${String(length <= 30)}
		aria-label=${`${title}, ${time}`}
		style=${`--top:${(placed.startMinute / 1440) * 100};--height:${(length / 1440) * 100};--col:${placed.column};--span:${placed.columns}`}
		@click=${(event: Event) => {
			event.stopPropagation();
			view.open(occurrence.item, occurrence);
		}}
		><span class="event-title">${title}</span><span class="event-time">${time}</span></button
	>`;
}

/** Propose a new event at the half hour a click on a free slot of `day`'s column points at. */
function proposeAt<E extends CalendarGridItem>(
	view: GridContext<E>,
	day: CalendarDay,
	event: MouseEvent,
): void {
	const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
	const fraction = box.height ? (event.clientY - box.top) / box.height : 0;
	// Within the day: the foot of the column is its last half hour, not the next day's midnight.
	const slot = Math.floor((Math.min(1, Math.max(0, fraction)) * 1440) / SLOT_MINUTES);
	const minute = Math.min(slot, 1440 / SLOT_MINUTES - 1) * SLOT_MINUTES;
	view.propose(
		zonedToUtc({ year: day.year, month: day.month, day: day.day, hour: 0, minute }, view.zone),
		false,
	);
}
