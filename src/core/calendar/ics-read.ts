// Import an iCalendar (RFC 5545) file as calendar events. Every VEVENT of every VCALENDAR is read
// (`ics-read-event.ts`); a changed occurrence (same UID, RECURRENCE-ID) becomes an exception of its
// series, a cancelled one (STATUS:CANCELLED or an EXDATE) a cancelled exception
// (`ics-read-changes.ts`), and of a UID, or a UID and RECURRENCE-ID, that appears twice the higher
// SEQUENCE wins. A changed occurrence whose series is not in the file joins the series the calendar
// holds (`stored`), else it is an event of its own, never one that replaces the series. An event
// takes the id of a stored one only when it is that event again (the same UID). Zones: from
// `ics-read-zone.ts` and `ics-zone-names.ts`. The importer never throws: what cannot be read is
// skipped, and what the events cannot hold (a property, a repeat rule, another component, an
// unknown zone) is listed once in `unsupported`, never dropped silently. DOM-free. New code.
import { type Component, readComponents, unescapeText } from './ics-lines';
import { exceptionsOf } from './ics-read-changes';
import {
	type EventDraft,
	type ReadContext,
	type ReadZone,
	eventLabel,
	readEvent,
} from './ics-read-event';
import { type Wall, wallAsUtc } from './ics-read-time';
import { type FileZone, fileZoneToUtc, readFileZone } from './ics-read-zone';
import { ianaZone, matchZone } from './ics-zone-names';
import { icsUtc } from './ics-write';
import type { CalendarEvent, EventException } from './model';
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
	 * Ids in use already, such as those of a calendar's events. An imported event takes one only
	 * when `stored` shows the event there is this same event; any other takes the next free id
	 * (`<id>-2`, `<id>-3`, ...), so an import never replaces another event. An event without a UID
	 * has no identity of its own: without this option such events are `event`, `event-2`, ... in
	 * file order.
	 */
	taken?: (id: string) => boolean;
	/**
	 * The calendar's event with an id, if any. It is the event a file brings again when it has the
	 * same UID; one without a `uid` has the UID `eventsToIcs` writes for it, `<id>@<uidDomain>`. Its
	 * id is then kept, so the import updates it. A changed occurrence whose series is not in the file
	 * but is this event (the same UID, repeating) becomes its exception, and the event is returned
	 * with it: an update to one occurrence then changes that occurrence of the series.
	 */
	stored?: (id: string) => CalendarEvent | undefined;
	/**
	 * The calendar's event whose `uid` is this, if any: the event a file brings again, wherever it
	 * stands. Without it, one that once took `<id>-2` (as `<id>` was taken then) is found only while
	 * every id before its own is still in use.
	 */
	storedByUid?: (uid: string) => CalendarEvent | undefined;
}

export interface IcsImport {
	events: CalendarEvent[];
	/** What the file holds that the events do not, each a short sentence, once. */
	unsupported: string[];
}

/** Calendar properties that hold nothing an event shows. */
const CALENDAR = new Set(['VERSION', 'PRODID', 'CALSCALE', 'METHOD']);
/**
 * The scheduling methods (RFC 5546 3.2) whose events are no event to keep, and why: an attendee's
 * answer, a proposed change and its refusal, a request for the latest copy, and occurrences added
 * to a series. Imported, each would replace the event of the same UID with what it says.
 */
const NOT_EVENTS = new Map<string, string>([
	...['REPLY', 'COUNTER', 'DECLINECOUNTER', 'REFRESH'].map(
		(method) => [method, 'answers an invitation and holds no event to import'] as const,
	),
	['ADD', 'adds occurrences to an event it does not hold, so nothing is imported'],
	// Read as events, a cancellation would replace the meeting it cancels with a blank one.
	[
		'CANCEL',
		'cancels a meeting of an invitation, so nothing is imported: delete it if you hold it',
	],
]);

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The zone of each TZID, resolved once; an IANA name by the platform's rules, never the file's. */
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
		// A parameter value is not TEXT, so it is looked up as written; a file that escaped it as the
		// TZID property is escaped still finds its zone.
		const file = files.get(name) ?? files.get(unescapeText(name));
		/** The platform's instant; a file's own rules for the zone, often old or partial, check it. */
		const checked = (ms: number, w: Wall): number => {
			if (file && fileZoneToUtc(file, w) !== ms)
				note(`Time zone "${name}" has other rules in the file: this browser's were used`);
			return ms;
		};
		let resolved: ReadZone;
		if (iana) resolved = { zone: iana, toUtc: (w) => checked(zonedToUtc(w, iana), w) };
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

/** An event with these exceptions, and no `exceptions` when there are none. */
function withExceptions(event: CalendarEvent, exceptions: EventException[]): CalendarEvent {
	const out: CalendarEvent = { ...event, exceptions };
	if (!exceptions.length) delete out.exceptions;
	return out;
}

/** Series, their changed occurrences and duplicates joined; ids from the UIDs. */
function assemble(
	drafts: readonly EventDraft[],
	options: ParseIcsOptions,
	note: (text: string) => void,
): CalendarEvent[] {
	const order: EventDraft[] = [];
	const masters = new Map<string, EventDraft>();
	/** The changed occurrences of each UID by RECURRENCE-ID, the latest version of each. */
	const changes = new Map<string, Map<number, EventDraft>>();
	for (const d of drafts) {
		if (d.uid && d.recurrenceId !== undefined) {
			const slots = changes.get(d.uid) ?? new Map<number, EventDraft>();
			changes.set(d.uid, slots);
			const seen = slots.get(d.recurrenceId);
			if (seen)
				note(
					`${eventLabel(d.event.title)} has a changed occurrence that appears more than once; the latest version was kept`,
				);
			// The higher SEQUENCE wins, as for a series; of two equal ones, the later in the file.
			if (!seen || d.sequence >= seen.sequence) slots.set(d.recurrenceId, d);
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
	const mine = (uid: string): boolean => own !== '' && uid.length > own.length && uid.endsWith(own);
	/** The id a UID gives: `<id>` of a UID `<id>@<uidDomain>`, else the UID itself. */
	const idOf = (uid: string): string => (mine(uid) ? uid.slice(0, -own.length) : uid || 'event');
	/** The id `<id>@<uidDomain>` gives back, which an event there holds without a `uid`. */
	const plainOf = (uid: string): string | undefined => (mine(uid) ? idOf(uid) : undefined);
	const used = new Set<string>();
	/** For each base id, where the search for an event without an identity starts again. */
	const resume = new Map<string, number>();
	/**
	 * The first of `base`, `base-2`, `base-3`, ... that no event of this file took and that the
	 * calendar does not use (`taken`, `stored`) or uses for this same event: the stored event there
	 * has the UID `key`, or no `uid` and stands at `plain`, the id that UID gives back. An event
	 * with neither (no UID) has no identity and never takes an id in use, so an import replaces no
	 * event but the one it brings again.
	 */
	const slot = (base: string, key?: string, plain?: string): [string, CalendarEvent?] => {
		const known = key === undefined ? undefined : options.storedByUid?.(key);
		if (known && !used.has(known.id)) return [known.id, known];
		const anonymous = key === undefined && plain === undefined;
		for (let n = anonymous ? (resume.get(base) ?? 1) : 1; ; n++) {
			const id = n === 1 ? base : `${base}-${n}`;
			if (used.has(id)) continue;
			const event = options.stored?.(id);
			if (!event && !options.taken?.(id)) {
				if (anonymous) resume.set(base, n + 1);
				return [id];
			}
			if (event?.id === id && (event.uid ? event.uid === key : id === plain)) return [id, event];
		}
	};
	/** An id for an event, and its UID unless the id gives the UID back. */
	const claim = (base: string, key?: string, plain?: string): Pick<CalendarEvent, 'id' | 'uid'> => {
		const [id] = slot(base, key, plain);
		used.add(id);
		return key === undefined || id === plain ? { id } : { id, uid: key };
	};
	const identify = (uid: string): Pick<CalendarEvent, 'id' | 'uid'> =>
		uid ? claim(idOf(uid), uid, plainOf(uid)) : claim('event');
	// An occurrence as an event of its own is that occurrence again on every import: its id comes
	// from its series' UID and its RECURRENCE-ID. It takes no UID: one UID is one series, and in a
	// file the occurrence would replace it. Moved on by an event at that id, it takes the UID this
	// app would write for its own id, so it is still itself the next time.
	const single = (uid: string, rid: number): Pick<CalendarEvent, 'id' | 'uid'> => {
		const base = `${idOf(uid)}-${icsUtc(rid)}`;
		return claim(base, own ? `${base}${own}` : undefined, base);
	};
	/** The calendar's series of a UID: the stored event of that UID, if it repeats. */
	const held = (uid: string): CalendarEvent | undefined => {
		const [, event] = slot(idOf(uid), uid, plainOf(uid));
		return event && event.repeat !== 'none' ? event : undefined;
	};
	const out: CalendarEvent[] = [];
	/** A series with its changed occurrences, and after it those an exception cannot hold. */
	const join = (series: EventDraft, slots: ReadonlyMap<number, EventDraft> | undefined): void => {
		const apart: [CalendarEvent, number][] = [];
		const changed = [...(slots?.values() ?? [])];
		const exceptions = exceptionsOf(series, changed, note, (e, rid) => apart.push([e, rid]));
		out.push(withExceptions(series.event, exceptions));
		for (const [e, rid] of apart) out.push({ ...e, ...single(series.uid, rid) });
	};
	for (const d of order) {
		join({ ...d, event: { ...d.event, ...identify(d.uid) } }, changes.get(d.uid));
		changes.delete(d.uid);
	}
	// Changed occurrences whose series is not in the file (an invitation to one occurrence).
	for (const [uid, slots] of changes) {
		const series = held(uid);
		if (series) {
			used.add(series.id);
			join({ event: series, uid, sequence: 0 }, slots);
			continue;
		}
		note(
			'An occurrence of a repeating event was imported on its own: the file does not hold its series',
		);
		for (const [rid, d] of slots) out.push({ ...d.event, ...single(uid, rid) });
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
	// A TZID names a VTIMEZONE of its own calendar (RFC 5545 3.6.5): two calendars in one file may
	// each define a zone by the same name, so each is read with its own zones.
	const read = roots.map((calendar) => {
		for (const p of calendar.properties)
			if (!CALENDAR.has(p.name)) note(`${p.name} is not imported`);
			else if (p.name === 'CALSCALE' && p.value.trim().toUpperCase() !== 'GREGORIAN')
				note(`CALSCALE:${p.value.trim()} is not supported; dates were read as Gregorian`);
		const files = new Map<string, FileZone>();
		for (const c of calendar.components) {
			if (c.name !== 'VTIMEZONE') continue;
			const zone = readFileZone(c);
			if (zone) files.set(zone.tzid, zone);
			else note('A VTIMEZONE could not be read');
		}
		const ctx: ReadContext = { floating, zone: zoneResolver(files, floating, note), note };
		return { calendar, ctx };
	});
	const drafts: EventDraft[] = [];
	const skipped = new Map<string, number>();
	for (const { calendar, ctx } of read) {
		const method = calendar.properties
			.find((p) => p.name === 'METHOD')
			?.value.trim()
			.toUpperCase();
		const why = method ? NOT_EVENTS.get(method) : undefined;
		if (why) {
			note(`METHOD:${method} ${why}`);
			continue;
		}
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
