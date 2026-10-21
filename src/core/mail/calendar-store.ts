// The mail calendar's event store: the shared `CalendarEvent` (`ooxml-core/calendar`) kept in memory
// and optionally persisted, re-validated when read back. The calendar views, the recurrence rules
// and the iCalendar reader and writer all live in the calendar area; this only stores. New code.
import type { CalendarEvent } from '../calendar/model';
import { createMemoryRecordStore, type MemoryStoreOptions, type RecordStore } from './record-store';

export type CalendarStore = RecordStore<CalendarEvent>;

const MAX_TEXT = 20_000;
const text = (value: unknown, max = MAX_TEXT): string | null =>
	typeof value === 'string' ? value.slice(0, max) : null;
const finite = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

/**
 * A stored event, or `null` when the record cannot be one. Required fields are checked and capped;
 * the optional recurrence fields are kept as stored (the recurrence code tolerates bad values).
 */
export function sanitizeEvent(raw: unknown): CalendarEvent | null {
	if (!raw || typeof raw !== 'object') return null;
	const value = raw as Record<string, unknown>;
	const id = text(value.id, 256);
	const zone = text(value.zone, 64);
	if (!id || !zone || !finite(value.start) || !finite(value.end) || value.end < value.start)
		return null;
	return {
		...(value as unknown as CalendarEvent),
		id,
		zone,
		title: text(value.title, 500) ?? '',
		description: text(value.description) ?? '',
	};
}

/** A calendar in memory, optionally persisted (see `createMemoryRecordStore`). */
export function createMemoryCalendarStore(
	options: MemoryStoreOptions<CalendarEvent> = {},
): CalendarStore {
	return createMemoryRecordStore({
		...options,
		key: options.key ?? 'ooxml-mail:calendar',
		sanitize: sanitizeEvent,
	});
}
