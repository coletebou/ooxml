// The values of date and time inputs (`YYYY-MM-DD`, `HH:MM`) for an instant in an IANA zone, and
// the instant they name, so an event form edits wall-clock times in the calendar's zone rather than
// the device's. DOM-free. New code.
import { dayKey, zonedParts, zonedToUtc } from 'ooxml-core/calendar';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const TIME = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/u;
const pad = (n: number): string => String(n).padStart(2, '0');

/** `2026-10-15`: the date input value of the instant in the zone. */
export const dateValue = (ms: number, zone: string): string => dayKey(ms, zone);

/** `09:30`: the time input value of the instant in the zone. */
export function timeValue(ms: number, zone: string): string {
	const p = zonedParts(ms, zone);
	return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** The year, month and day of a date input value, or null when it is not a real date. */
export function parseDate(value: string): { year: number; month: number; day: number } | null {
	const m = DATE.exec(value);
	if (!m) return null;
	const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const check = new Date(Date.UTC(year, month - 1, day));
	return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1
		? { year, month, day }
		: null;
}

/** The date input value `days` after (or before) another one, or '' when it is not a date. */
export function shiftDate(value: string, days: number): string {
	const date = parseDate(value);
	if (!date) return '';
	const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
	return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

/** Whole days from one date input value to another, or null when either is not a date. */
export function daysBetween(from: string, to: string): number | null {
	const a = parseDate(from);
	const b = parseDate(to);
	if (!a || !b) return null;
	return Math.round(
		(Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
	);
}

/**
 * The instant a date and a time input name in the zone (midnight without a time), or null when the
 * values are not a date and a time.
 */
export function fromInputs(date: string, time: string, zone: string): number | null {
	const day = parseDate(date);
	const clock = time ? TIME.exec(time) : null;
	if (!day || (time && !clock)) return null;
	const hour = clock ? Number(clock[1]) : 0;
	const minute = clock ? Number(clock[2]) : 0;
	if (hour > 23 || minute > 59) return null;
	return zonedToUtc({ ...day, hour, minute }, zone);
}
