// One event as a compact button, in a day's all-day row and in the days of the month grid. A timed
// event shows its start time on the day it starts; its accessible name carries the title and the
// times (or the product's "All day"). New code.
import { html, nothing } from 'lit';
import type { CalendarDay } from 'ooxml-core/calendar';
import { clockText, eventTitle, timeRange } from './format';
import type { CalendarGridItem, GridContext, ShownOccurrence } from './types';

/** An event chip for `day`; activating it opens the occurrence. */
export function eventChip<E extends CalendarGridItem>(
	view: GridContext<E>,
	occurrence: ShownOccurrence<E>,
	day: Pick<CalendarDay, 'start' | 'end'>,
) {
	const title = eventTitle(view, occurrence);
	const allDay = occurrence.dates !== undefined;
	const when = allDay ? view.label('allDay') : timeRange(view, occurrence);
	const startsHere = !allDay && occurrence.start >= day.start && occurrence.start < day.end;
	return html`<button
		type="button"
		class="chip"
		data-all-day=${String(allDay)}
		data-live=${String(Boolean(occurrence.item.live))}
		data-mine=${String(Boolean(occurrence.item.mine))}
		aria-label=${`${title}, ${when}`}
		@click=${(event: Event) => {
			event.stopPropagation();
			view.open(occurrence.item, occurrence);
		}}
		>${startsHere ? html`<span class="chip-time">${clockText(occurrence.start, view.zone, view.intl)}</span>` : nothing}<span
			class="chip-title"
			>${title}</span
		></button
	>`;
}
