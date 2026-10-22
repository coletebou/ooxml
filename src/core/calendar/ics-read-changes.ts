// The exceptions an imported series takes from its file: its EXDATEs and its changed occurrences
// (VEVENTs with its UID and a RECURRENCE-ID). An occurrence moved to another time keeps only what
// changed; one cancelled, by STATUS:CANCELLED or an EXDATE, is a cancelled exception, though an
// occurrence written for a slot an EXDATE cancelled wins over the EXDATE; one changed between all
// day and a set time, which an exception cannot hold, becomes an event of its own. The series may
// also be one the calendar holds already, its exceptions then the ones it had. What cannot be kept
// is reported through `note`. Split from `ics-read.ts`. DOM-free. New code.
import { type EventDraft, eventLabel } from './ics-read-event';
import type { CalendarEvent, EventException } from './model';
import { occurrenceEnd } from './occurrences';
import { seriesIndexOf } from './recurrence';

/** Who is on an event, for telling whether an occurrence changed it. */
const people = (e: CalendarEvent): string =>
	[
		e.organizer?.email ?? e.organizer?.name ?? '',
		...(e.attendees ?? [])
			.map((a) => `${a.email ?? a.name}|${a.response ?? ''}|${a.optional ? 1 : 0}`)
			.sort(),
	].join('\n');

/** An occurrence as an event of its own: its times, text and people, and no repeat. */
function single(occurrence: CalendarEvent, title: string): CalendarEvent {
	const event: CalendarEvent = { ...occurrence, title, repeat: 'none' };
	delete event.count;
	delete event.until;
	delete event.monthlyBy;
	delete event.ordinal;
	delete event.exceptions;
	return event;
}

/**
 * The exceptions of a series: the ones it has (its EXDATEs) and its changed occurrences, the latest
 * version of each (one per RECURRENCE-ID). An occurrence an exception cannot hold is cancelled in
 * the series and handed to `apart`, with its RECURRENCE-ID, as an event of its own.
 */
export function exceptionsOf(
	master: EventDraft,
	changes: readonly EventDraft[],
	note: (text: string) => void,
	apart: (event: CalendarEvent, recurrenceId: number) => void,
): EventException[] {
	const m = master.event;
	const label = eventLabel(m.title);
	const out = new Map<number, EventException>();
	// Some calendars write a moved occurrence as an EXDATE of its slot plus the occurrence on its own
	// (RECURRENCE-ID), so an occurrence replaces whatever exception its slot had.
	for (const e of m.exceptions ?? []) out.set(e.originalStart, e);
	for (const change of changes) {
		const rid = change.recurrenceId;
		const o = change.event;
		if (rid === undefined) continue;
		if (m.repeat === 'none') {
			note(`${label} is imported without its repeat, so its changed occurrences were not`);
			continue;
		}
		if (change.thisAndFuture) {
			note(`A change to "this and later occurrences" of ${label} was not imported`);
			continue;
		}
		if (seriesIndexOf(m, rid) === null) {
			note(`A changed occurrence of ${label} is not on its series and was not imported`);
			continue;
		}
		if (o.cancelled) {
			out.set(rid, { originalStart: rid, cancelled: true });
			continue;
		}
		// An exception keeps the series' kind (all day or at a set time): an occurrence that changed
		// kind leaves its slot and is kept whole, as an event of its own.
		if (Boolean(o.allDay) !== Boolean(m.allDay)) {
			note(
				`An occurrence of ${label} changed between all day and a set time; it was imported as an event of its own`,
			);
			out.set(rid, { originalStart: rid, cancelled: true });
			apart(single(o, o.title || m.title), rid);
			continue;
		}
		if ((o.location ?? '') !== (m.location ?? ''))
			note('A changed location of a single occurrence is not imported');
		if (people(o) !== people(m)) note('Changed people of a single occurrence are not imported');
		if (o.reminder !== m.reminder)
			note('A changed reminder of a single occurrence is not imported');
		const moved = o.start !== rid || o.end !== occurrenceEnd(m, rid);
		out.set(rid, {
			originalStart: rid,
			cancelled: false,
			...(moved ? { start: o.start, end: o.end } : {}),
			...(o.title && o.title !== m.title ? { title: o.title } : {}),
			...(o.description !== m.description ? { description: o.description } : {}),
		});
	}
	return [...out.values()].sort((a, b) => a.originalStart - b.originalStart);
}
