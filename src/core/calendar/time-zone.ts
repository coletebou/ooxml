// Time-zone arithmetic on instants (UTC milliseconds) with the platform's IANA data, no library:
// wall-clock parts of an instant in a zone, the instant of a wall-clock time in a zone (DST gaps
// move forward; a repeated hour is its first occurrence, as RFC 5545 3.3.5 reads it), and day
// starts and day steps that keep the local time of day across daylight saving changes. Calendar code stores UTC and renders in a zone. DOM-free. Moved from
// src/core/teams/time-zone.ts.

import { zoneFormatter } from './zone-formatters';

export interface ZonedParts {
	year: number;
	/** 1-12. */
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
	/** 0 = Sunday. */
	weekday: number;
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
/** The furthest instant from 1970, before or after, that a `Date` holds (ECMA-262 21.4.1.1). */
export const MAX_INSTANT = 8.64e15;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function isValidZone(zone: unknown): zone is string {
	if (typeof zone !== 'string' || zone.length === 0 || zone.length > 64) return false;
	try {
		return Boolean(zoneFormatter(zone));
	} catch {
		return false;
	}
}

/** The viewer's zone, UTC when the platform does not say. */
export function localZone(): string {
	try {
		const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
		return isValidZone(zone) ? zone : 'UTC';
	} catch {
		return 'UTC';
	}
}

export function zonedParts(ms: number, zone: string): ZonedParts {
	const out: Record<string, string> = {};
	for (const part of zoneFormatter(zone).formatToParts(new Date(ms))) out[part.type] = part.value;
	return {
		year: Number(out.year),
		month: Number(out.month),
		day: Number(out.day),
		hour: Number(out.hour) % 24,
		minute: Number(out.minute),
		second: Number(out.second),
		weekday: Math.max(0, WEEKDAYS.indexOf(out.weekday ?? '')),
	};
}

/** Minutes the zone is ahead of UTC at that instant. */
export function offsetMinutes(ms: number, zone: string): number {
	const p = zonedParts(ms, zone);
	const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
	return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MINUTE_MS);
}

export type WallTime = Pick<ZonedParts, 'year' | 'month' | 'day'> &
	Partial<Pick<ZonedParts, 'hour' | 'minute' | 'second'>>;

/**
 * The instant of a wall time `naive` (as if UTC) in a zone whose offset at an instant `offsetAt`
 * gives, in minutes: of the offsets the zone has within a day of it, the earliest instant whose
 * clock reads that time, so a repeated hour is its first occurrence (RFC 5545 3.3.5); a time in a
 * gap, which no clock reads, as the offset before the gap reads it, which moves it forward.
 */
export function wallToInstant(naive: number, offsetAt: (ms: number) => number): number {
	const offsets = new Set([naive - DAY_MS, naive, naive + DAY_MS].map(offsetAt));
	const reads = [...offsets]
		.map((offset) => naive - offset * MINUTE_MS)
		.filter((ms) => ms + offsetAt(ms) * MINUTE_MS === naive);
	return reads.length ? Math.min(...reads) : naive - offsetAt(naive - DAY_MS) * MINUTE_MS;
}

/** The instant at which a zone's clocks read this wall time. Out-of-range fields roll over. */
export function zonedToUtc(wall: WallTime, zone: string): number {
	const naive = Date.UTC(
		wall.year,
		wall.month - 1,
		wall.day,
		wall.hour ?? 0,
		wall.minute ?? 0,
		wall.second ?? 0,
	);
	return wallToInstant(naive, (ms) => offsetMinutes(ms, zone));
}

/** The instant of local midnight of the day containing `ms`. */
export function startOfDay(ms: number, zone: string): number {
	const p = zonedParts(ms, zone);
	return zonedToUtc({ year: p.year, month: p.month, day: p.day }, zone);
}

/** The same local time of day, `days` later (or earlier) in the zone. */
export function addDays(ms: number, days: number, zone: string): number {
	const p = zonedParts(ms, zone);
	return zonedToUtc({ ...p, day: p.day + days }, zone);
}

/** The local wall time of an instant as a sortable key such as `2026-10-15`. */
export function dayKey(ms: number, zone: string): string {
	const p = zonedParts(ms, zone);
	return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Minutes after local midnight, so a day with a DST change still lines up with the clock. */
export function minuteOfDay(ms: number, zone: string): number {
	const p = zonedParts(ms, zone);
	return p.hour * 60 + p.minute;
}
