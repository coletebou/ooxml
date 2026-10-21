// The DATE, DATE-TIME, DURATION and UTC-OFFSET values of an iCalendar file (RFC 5545 sections
// 3.3.4 to 3.3.6 and 3.3.14), read tolerantly: the seconds of a time may be missing and the
// letters may be lower case. Years before 1000 are refused (the platform's date arithmetic reads
// two-digit years as 19xx). DOM-free. New code.
import { daysInMonth } from './recurrence-calendar';

/** A wall-clock time with every field. */
export interface Wall {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

export interface IcsDateValue {
	wall: Wall;
	/** Only a date (`VALUE=DATE`): no time of day. */
	date: boolean;
	/** A UTC time (a `Z` suffix). */
	utc: boolean;
}

const DATE_VALUE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/iu;

export function readDateValue(text: string): IcsDateValue | null {
	const m = DATE_VALUE.exec(text.trim());
	if (!m) return null;
	const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const [hour, minute, second] = [Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
	if (year < 1000 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month))
		return null;
	// 60 is a leap second, read as the second before.
	if (hour > 23 || minute > 59 || second > 60) return null;
	return {
		wall: { year, month, day, hour, minute, second: Math.min(second, 59) },
		date: m[4] === undefined,
		utc: m[7] !== undefined,
	};
}

/** The instant a wall time names when it is read as UTC. */
export const wallAsUtc = (w: Wall): number =>
	Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);

export interface IcsDuration {
	/** Whole days (a week is seven): nominal, so a day across a clock change is 23 or 25 hours. */
	days: number;
	/** Hours, minutes and seconds: exact. */
	ms: number;
	/** -1 for a duration before (`-PT15M`). */
	sign: 1 | -1;
}

const DURATION = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/iu;

export function readDuration(text: string): IcsDuration | null {
	const value = text.trim();
	const m = DURATION.exec(value);
	// `P` and `PT` alone match the pattern but say nothing.
	if (!m || /^[+-]?PT?$/iu.test(value) || /T$/iu.test(value)) return null;
	const n = (i: number): number => Number(m[i] ?? 0);
	return {
		days: n(2) * 7 + n(3),
		ms: ((n(4) * 60 + n(5)) * 60 + n(6)) * 1000,
		sign: m[1] === '-' ? -1 : 1,
	};
}

/** `+0100`, `-0430` or `+053000` as minutes ahead of UTC. */
export function readUtcOffset(text: string): number | null {
	const m = /^([+-])(\d{2})(\d{2})(\d{2})?$/u.exec(text.trim());
	if (!m) return null;
	const minutes = Number(m[2]) * 60 + Number(m[3]) + Math.round(Number(m[4] ?? 0) / 60);
	return m[1] === '-' ? -minutes : minutes;
}
