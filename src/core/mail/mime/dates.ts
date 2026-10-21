// `Date` fields: RFC 5322 section 3.3 date-times, read with the obsolete forms of section 4.3 and
// what mail programs write besides (asctime order, ISO 8601, full day and month names), and
// written in the RFC 5322 form. New code.
import { stripComments } from './syntax';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec',
];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_MONTHS = [
	'january',
	'february',
	'march',
	'april',
	'may',
	'june',
	'july',
	'august',
	'september',
	'october',
	'november',
	'december',
];
/** The obsolete zones of RFC 5322 section 4.3, in minutes east of UTC. */
const ZONES: Readonly<Record<string, number>> = {
	ut: 0,
	utc: 0,
	gmt: 0,
	z: 0,
	est: -300,
	edt: -240,
	cst: -360,
	cdt: -300,
	mst: -420,
	mdt: -360,
	pst: -480,
	pdt: -420,
};
const ISO =
	/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(z|[+-]\d{2}:?\d{2})?$/i;

interface Parts {
	day?: number;
	month?: number;
	year?: number;
	hour: number;
	minute: number;
	second: number;
	/** Minutes east of UTC. */
	zone: number;
	pm?: boolean;
}

const zoneMinutes = (sign: string, hours: string, minutes: string): number =>
	(sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes));

function monthOf(word: string): number | undefined {
	const index = MONTHS.indexOf(word.slice(0, 3));
	return index >= 0 && FULL_MONTHS[index]!.startsWith(word) ? index : undefined;
}

function readToken(token: string, parts: Parts): void {
	let match = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.\d+)?)?$/.exec(token);
	if (match) {
		parts.hour = Number(match[1]);
		parts.minute = Number(match[2]);
		parts.second = Number(match[3] ?? 0);
		return;
	}
	match = /^([+-])(\d{2}):?(\d{2})$/.exec(token) ?? /^([+-])(\d{2})()$/.exec(token);
	if (match) {
		parts.zone = zoneMinutes(match[1]!, match[2]!, match[3] || '0');
		return;
	}
	if (/^\d+$/.test(token)) {
		const value = Number(token);
		if (token.length >= 3) parts.year ??= token.length === 3 ? value + 1900 : value;
		else if (parts.day === undefined) parts.day = value;
		else parts.year ??= value < 50 ? value + 2000 : value + 1900;
		return;
	}
	const word = token.toLowerCase().replace(/\.$/, '');
	const month = monthOf(word);
	if (month !== undefined) parts.month = month;
	else if (word === 'am' || word === 'pm') parts.pm = word === 'pm';
	else if (Object.hasOwn(ZONES, word)) parts.zone = ZONES[word]!;
	// Day names, military zones and unknown zones are -0000: no offset (section 4.3).
}

function fromIso(match: RegExpExecArray): number | undefined {
	const [, year, month, day, hour = '0', minute = '0', second = '0', zone = 'z'] = match;
	const offset = /^z$/i.test(zone) ? 0 : zoneMinutes(zone[0]!, zone.slice(1, 3), zone.slice(-2));
	return toTime({
		year: Number(year),
		month: Number(month) - 1,
		day: Number(day),
		hour: Number(hour),
		minute: Number(minute),
		second: Number(second),
		zone: offset,
	});
}

function toTime(parts: Parts): number | undefined {
	const { day, month, year, minute, zone } = parts;
	let hour = parts.hour;
	if (parts.pm !== undefined && hour >= 1 && hour <= 12) hour = (hour % 12) + (parts.pm ? 12 : 0);
	const second = Math.min(parts.second, 59);
	if (day === undefined || month === undefined || year === undefined || year < 1000)
		return undefined;
	if (hour > 23 || minute > 59 || second > 59 || day < 1) return undefined;
	if (day > new Date(Date.UTC(year, month + 1, 0)).getUTCDate()) return undefined;
	const time = Date.UTC(year, month, day, hour, minute, second) - zone * 60_000;
	// A year past what a date can hold is NaN here, and so is the zone moving the time out of range.
	return Number.isNaN(new Date(time).getTime()) ? undefined : time;
}

/**
 * The time of a `Date` value in UTC milliseconds, or `undefined` when it cannot be read. Accepts
 * RFC 5322 date-times with or without the day name and seconds, comments and white space anywhere
 * (`09(comment) : 55`), two- and three-digit years (`97` is 1997, `03` is 2003), the obsolete
 * zones (`EST`, `GMT`; military and unknown ones are UTC), `21-Nov-97`, asctime order
 * (`Mon Jan  5 09:00:00 2026`), `AM`/`PM`, and ISO 8601. A missing zone is read as UTC.
 */
export function parseDate(value: string | undefined): number | undefined {
	if (!value) return undefined;
	// White space is collapsed first: `\s*:\s*` alone backtracks over long runs of it.
	const text = stripComments(value).replace(/\s+/g, ' ').replace(/ ?: ?/g, ':').trim();
	const iso = ISO.exec(text);
	if (iso) return fromIso(iso);
	const parts: Parts = { hour: 0, minute: 0, second: 0, zone: 0 };
	const spaced = text.replace(/\b(\d{1,2})-([A-Za-z]{3,9})-(\d{2,4})\b/g, '$1 $2 $3');
	for (const token of spaced.split(/[\s,]+/)) if (token) readToken(token, parts);
	return toTime(parts);
}

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * `ms` as an RFC 5322 date-time, `Mon, 05 Jan 2026 09:00:00 +0000`, in the zone `offsetMinutes`
 * east of UTC. Seconds are whole (milliseconds are dropped). Throws a `RangeError` for a time that
 * is not finite.
 */
export function formatDate(ms: number, offsetMinutes = 0): string {
	if (!Number.isFinite(ms) || !Number.isFinite(offsetMinutes)) throw new RangeError('Invalid date');
	const offset = Math.round(offsetMinutes);
	const local = new Date(ms + offset * 60_000);
	if (Number.isNaN(local.getTime())) throw new RangeError('Invalid date');
	const zone = `${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`;
	const year = String(local.getUTCFullYear()).padStart(4, '0');
	const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
	return `${DAY_NAMES[local.getUTCDay()]}, ${pad(local.getUTCDate())} ${MONTH_NAMES[local.getUTCMonth()]} ${year} ${time} ${zone}`;
}
