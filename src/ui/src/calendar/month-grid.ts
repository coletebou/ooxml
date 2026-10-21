// The month view: six weeks of seven days from `monthGrid`, each day with its events (all-day and
// multi-day ones on every day they touch, from `eventsByDay`), the first few of a full day and a
// "+N more", today marked and the days of the months around it dimmed. A day's number opens that
// day, as does its "+N more"; a click on the free part of a day proposes an all-day event there.
// The selected day (the view's anchor) keeps the only tab stop among the day numbers: the arrow
// keys, Home and End (the week) and Page Up and Page Down (the month) move it. New code.
import { html, nothing } from 'lit';
import {
	type MonthDay,
	addDays,
	eventsByDay,
	shiftAnchor,
	startOfDay,
	zonedParts,
} from 'ooxml-core/calendar';
import { eventChip } from './chip';
import { dateFormat, dayName, weekdayName } from './format';
import type { CalendarGridItem, GridContext, ShownOccurrence } from './types';

/** Events a day lists before a "+N more"; a fuller day lists one fewer and the "+N more". */
export const MONTH_DAY_EVENTS = 3;

const STEPS: Readonly<Record<string, number>> = {
	ArrowLeft: -1,
	ArrowRight: 1,
	ArrowUp: -7,
	ArrowDown: 7,
};

/** The month grid of `weeks`; `shown` are the occurrences around them. */
export function monthGrid<E extends CalendarGridItem>(
	view: GridContext<E>,
	weeks: readonly (readonly MonthDay[])[],
	shown: readonly ShownOccurrence<E>[],
) {
	const days = weeks.flat();
	const byDay = eventsByDay(shown, days, view.zone);
	const today = startOfDay(view.now, view.zone);
	const selected = startOfDay(view.anchor, view.zone);
	return html`<div class="month" @keydown=${(event: KeyboardEvent) => keydown(view, event)}
		>${(weeks[0] ?? []).map(
			(d) =>
				html`<span class="weekday" aria-hidden="true"
					>${weekdayName(d.start, view.zone, view.intl)}</span
				>`,
		)}${days.map((d) => monthDay(view, d, byDay.get(d.start) ?? [], d.start === today, d.start === selected))}</div
	>`;
}

function monthDay<E extends CalendarGridItem>(
	view: GridContext<E>,
	day: MonthDay,
	events: readonly ShownOccurrence<E>[],
	today: boolean,
	selected: boolean,
) {
	const listed = events.length > MONTH_DAY_EVENTS ? MONTH_DAY_EVENTS - 1 : events.length;
	const hidden = events.length - listed;
	const name = dayName(day, view.zone, view.intl);
	// The first of a month carries the month's name, so a grid that starts in another month reads.
	const number =
		day.day === 1
			? dateFormat(view.intl, { month: 'short', day: 'numeric', timeZone: view.zone }).format(
					day.start,
				)
			: String(day.day);
	const more = hidden
		? html`<button type="button" class="more" @click=${() => view.showDay(day)}
				>${view.label('more', { count: hidden })}</button
			>`
		: nothing;
	return html`<div
		class="day"
		role="group"
		aria-label=${name}
		data-outside=${String(!day.inMonth)}
		data-today=${String(today)}
		data-selected=${String(selected)}
		@click=${(event: MouseEvent) => {
			if (event.target === event.currentTarget) view.propose(day.start, true);
		}}
		><button
			type="button"
			class="date"
			tabindex=${selected ? '0' : '-1'}
			aria-label=${view.label('openDay', { date: name })}
			aria-current=${today ? 'date' : nothing}
			@click=${() => view.showDay(day)}
			>${number}</button
		>${events.slice(0, listed).map((o) => eventChip(view, o, day))}${more}</div
	>`;
}

/** Move the selected day with the keyboard while a day's number has the focus. */
function keydown<E extends CalendarGridItem>(view: GridContext<E>, event: KeyboardEvent): void {
	const target = event.target as HTMLElement | null;
	if (!target?.classList.contains('date') || event.altKey || event.ctrlKey || event.metaKey) return;
	const anchor = view.anchor;
	let next: number | undefined;
	const step = STEPS[event.key];
	if (step !== undefined) {
		// Left and right follow the reading direction.
		const rtl = getComputedStyle(target).direction === 'rtl' && Math.abs(step) === 1;
		next = addDays(anchor, rtl ? -step : step, view.zone);
	} else if (event.key === 'Home' || event.key === 'End') {
		const intoWeek = (zonedParts(anchor, view.zone).weekday - view.weekStartsOn + 7) % 7;
		next = addDays(anchor, event.key === 'Home' ? -intoWeek : 6 - intoWeek, view.zone);
	} else if (event.key === 'PageUp' || event.key === 'PageDown') {
		next = shiftAnchor(anchor, 'month', event.key === 'PageUp' ? -1 : 1, view.zone);
	}
	if (next === undefined) return;
	event.preventDefault();
	view.select(next);
}
