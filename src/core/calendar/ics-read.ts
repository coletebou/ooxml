// Import an iCalendar (RFC 5545) file as calendar events. Every VEVENT of every VCALENDAR is read
// (`ics-read-event.ts`); a changed occurrence (same UID, RECURRENCE-ID) becomes an exception of its
// series, a cancelled one (STATUS:CANCELLED or an EXDATE) a cancelled exception
// (`ics-read-changes.ts`), and of a UID that appears twice the higher SEQUENCE wins. Time zones
// come from `ics-read-zone.ts`. The importer never throws: what cannot be read is skipped, and what
// the events cannot hold (a property, a repeat rule, another component, an unknown zone) is listed
// once in `unsupported`, never dropped silently. DOM-free. New code.
import { type Component, readComponents } from './ics-lines';
import { exceptionsOf } from './ics-read-changes';
import {
	type EventDraft,
	type ReadContext,
	type ReadZone,
	eventLabel,
	readEvent,
} from './ics-read-event';
import { type Wall, wallAsUtc } from './ics-read-time';
import { type FileZone, fileZoneToUtc, ianaZone, matchZone, readFileZone } from './ics-read-zone';
import type { CalendarEvent } from './model';
import { isValidZone, zonedToUtc } from './time-zone';

export interface ParseIcsOptions {
	/** The IANA zone floating times and all-day dates are read in. UTC by default. */
	zone?: string;
	/**
	 * The domain `eventsToIcs` wrote UIDs with: a UID `<id>@<uidDomain>` gives back the event id
	 * `<id>`. Any other UID is the event's id and its `uid`.
	 */
	uidDomain?: string;
	/**
	 * Ids in use already, such as those of a calendar's events: an event without a UID, which has
	 * no identity of its own, gets an id that is not, so it never replaces one an earlier import
	 * brought. Without it, such events are `event`, `event-2`, ... in file order.
	 */
	taken?: (id: string) => boolean;
}

export interface IcsImport {
	events: CalendarEvent[];
	/** What the file holds that the events do not, each a short sentence, once. */
	unsupported: string[];
}

/** Calendar properties that hold nothing an event shows. */
const CALENDAR = new Set(['VERSION', 'PRODID', 'CALSCALE', 'METHOD']);

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The zone of each TZID, resolved once. */
function zoneResolver(
	files: ReadonlyMap<string, FileZone>,
	floating: string,
	note: (text: string) => void,
): ReadContext['zone'] {
	const cache = new Map<string, ReadZone>();
	const local: ReadZone = { zone: floating, toUtc: (w: Wall) => zonedToUtc(w, floating) };
	return (tzid, year) => {
		const name = tzid?.trim() ?? '';
		if (!name) return local;
		const hit = cache.get(name);
		if (hit) return hit;
		const iana = ianaZone(name);
		const file = files.get(name);
		let resolved: ReadZone;
		if (iana) resolved = { zone: iana, toUtc: (w) => zonedToUtc(w, iana) };
		else if (file) {
			const matched = matchZone(file, year);
			if (!matched) note(`Time zone "${name}" matches no known zone: repeats in it keep UTC time`);
			resolved = { zone: matched ?? 'UTC', toUtc: (w) => fileZoneToUtc(file, w) };
		} else {
			note(
				`Time zone "${name}" is unknown and the file does not describe it: its times were read as UTC`,
			);
			resolved = { zone: 'UTC', toUtc: wallAsUtc };
		}
		cache.set(name, resolved);
		return resolved;
	};
}

/** Series, their changed occurrences and duplicates joined; ids from the UIDs. */
function assemble(
	drafts: readonly EventDraft[],
	options: ParseIcsOptions,
	note: (text: string) => void,
): CalendarEvent[] {
	const order: EventDraft[] = [];
	const masters = new Map<string, EventDraft>();
	const changes = new Map<string, EventDraft[]>();
	for (const d of drafts) {
		if (d.uid && d.recurrenceId !== undefined) {
			changes.set(d.uid, [...(changes.get(d.uid) ?? []), d]);
			continue;
		}
		const seen = d.uid ? masters.get(d.uid) : undefined;
		if (!seen) {
			if (d.uid) masters.set(d.uid, d);
			order.push(d);
			continue;
		}
		note(`${eventLabel(d.event.title)} appears more than once; the latest version was kept`);
		if (d.sequence > seen.sequence) {
			masters.set(d.uid, d);
			order[order.indexOf(seen)] = d;
		}
	}
	const own = options.uidDomain ? `@${options.uidDomain}` : '';
	const used = new Set<string>();
	const identify = (uid: string): Pick<CalendarEvent, 'id' | 'uid'> => {
		const mine = own !== '' && uid.length > own.length && uid.endsWith(own);
		const base = mine ? uid.slice(0, -own.length) : uid || 'event';
		// An event with a UID is the same event again on a second import; one without has no
		// identity, so it takes no id in use (`taken`).
		const free = (id: string): boolean => !used.has(id) && (uid !== '' || !options.taken?.(id));
		let id = base;
		for (let n = 2; !free(id); n++) id = `${base}-${n}`;
		used.add(id);
		return mine || !uid ? { id } : { id, uid };
	};
	const out: CalendarEvent[] = [];
	for (const d of order) {
		const apart: CalendarEvent[] = [];
		const exceptions = exceptionsOf(d, (d.uid && changes.get(d.uid)) || [], note, (e) =>
			apart.push(e),
		);
		changes.delete(d.uid);
		const event: CalendarEvent = { ...d.event, ...identify(d.uid) };
		if (exceptions.length) event.exceptions = exceptions;
		else delete event.exceptions;
		out.push(event);
		// Without the series' UID: one UID is one series, and a file that had two would lose one.
		for (const e of apart) out.push({ ...e, id: identify(d.uid).id });
	}
	// Changed occurrences whose series is not in the file (an invitation to one occurrence).
	for (const [uid, list] of changes)
		for (const d of list) {
			note(
				'An occurrence of a repeating event was imported on its own: the file does not hold its series',
			);
			out.push({ ...d.event, ...identify(uid) });
		}
	return out;
}

function readCalendars(
	text: string,
	options: ParseIcsOptions,
	note: (text: string) => void,
): CalendarEvent[] {
	const tree = readComponents(text);
	if (tree.unreadable) note(`${plural(tree.unreadable, 'line', 'lines')} could not be read`);
	for (const name of new Set(tree.unclosed))
		note(`${name} was not closed (END:${name} is missing)`);
	const calendars = tree.components.filter((c) => c.name === 'VCALENDAR');
	// Events written without a VCALENDAR around them are still read.
	const loose = tree.components.filter((c) => c.name !== 'VCALENDAR');
	const roots: Component[] = [
		...calendars,
		...(loose.length ? [{ name: 'VCALENDAR', properties: [], components: loose }] : []),
	];
	if (!calendars.length && !loose.some((c) => c.name === 'VEVENT')) {
		if (text.trim()) note('The text holds no calendar (BEGIN:VCALENDAR)');
		if (!loose.length) return [];
	}
	let floating = 'UTC';
	if (options.zone !== undefined) {
		if (isValidZone(options.zone)) floating = options.zone;
		else note(`The zone "${options.zone}" is unknown: floating times and dates were read in UTC`);
	}
	const files = new Map<string, FileZone>();
	for (const calendar of roots) {
		for (const p of calendar.properties)
			if (!CALENDAR.has(p.name)) note(`${p.name} is not imported`);
			else if (p.name === 'CALSCALE' && p.value.trim().toUpperCase() !== 'GREGORIAN')
				note(`CALSCALE:${p.value.trim()} is not supported; dates were read as Gregorian`);
		for (const c of calendar.components) {
			if (c.name !== 'VTIMEZONE') continue;
			const zone = readFileZone(c);
			if (zone) files.set(zone.tzid, zone);
			else note('A VTIMEZONE could not be read');
		}
	}
	const ctx: ReadContext = { floating, zone: zoneResolver(files, floating, note), note };
	const drafts: EventDraft[] = [];
	const skipped = new Map<string, number>();
	for (const calendar of roots)
		for (const c of calendar.components) {
			if (c.name === 'VTIMEZONE') continue;
			if (c.name !== 'VEVENT') {
				skipped.set(c.name, (skipped.get(c.name) ?? 0) + 1);
				continue;
			}
			try {
				const draft = readEvent(c, ctx);
				if (draft) drafts.push(draft);
			} catch {
				note('An event could not be read and was skipped');
			}
		}
	for (const [name, n] of skipped)
		note(`${plural(n, `${name} component`, `${name} components`)} not imported`);
	return assemble(drafts, options, note);
}

/** The events of an iCalendar text, and what of it they do not hold. Never throws. */
export function parseIcs(text: string, options: ParseIcsOptions = {}): IcsImport {
	const notes = new Set<string>();
	const note = (line: string): void => {
		notes.add(line);
	};
	let events: CalendarEvent[] = [];
	try {
		events = readCalendars(typeof text === 'string' ? text : '', options, note);
	} catch {
		note('The file could not be read');
	}
	return { events, unsupported: [...notes] };
}
