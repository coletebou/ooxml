// The time zones of an imported iCalendar file. A TZID that names an IANA zone is resolved with
// `Intl`, also behind a path prefix such as `/mozilla.org/20050126_1/Europe/Berlin`. Any other name
// (a display name such as `W. Europe Standard Time`) is read from the file's own VTIMEZONE: its
// STANDARD and DAYLIGHT observances (a first onset, the offsets before and after, a yearly RRULE by
// month and weekday ordinal or by weekday and month days, either with one BYSETPOS, RDATEs) give
// the offset at any instant.
// Times are converted with those rules; a repeat keeps its time in the IANA zone whose clock
// changes match them in the event's year (a city named in the TZID first, then a short list of
// common zones, then every zone the platform knows). Without a match a repeat keeps UTC time.
// DOM-free. New code.
import { type ContentLine, type Component, unescapeText } from './ics-lines';
import { type Wall, readDateValue, readUtcOffset, wallAsUtc } from './ics-read-time';
import { daysInMonth, nthWeekdayOfMonth } from './recurrence-calendar';
import { MINUTE_MS, isValidZone, offsetMinutes } from './time-zone';

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
/** The days of a month's first week, and of the whole of the longest month. */
const FIRST_WEEK = [1, 2, 3, 4, 5, 6, 7];
const MONTH = Array.from({ length: 31 }, (_, i) => i + 1);

interface YearlyRule {
	month: number;
	/** 0 = Sunday. */
	weekday?: number;
	/** 1 to 4, or -1 for the last. */
	ordinal?: number;
	monthDays?: number[];
	/** BYSETPOS: which of the days the rest of the rule finds is meant (1 the first, -1 the last). */
	setPos?: number;
	until?: number;
	count?: number;
}

interface Observance {
	/** The first onset, on the clock before the change. */
	onset: Wall;
	from: number;
	to: number;
	rule?: YearlyRule;
	dates: Wall[];
}

export interface FileZone {
	tzid: string;
	observances: Observance[];
}

interface Change {
	at: number;
	from: number;
	to: number;
}

const first = (c: Component, name: string): ContentLine | undefined =>
	c.properties.find((p) => p.name === name);

function readYearlyRule(value: string, onset: Wall): YearlyRule | undefined {
	const parts = new Map(
		value.split(';').map((p): [string, string] => {
			const eq = p.indexOf('=');
			return [
				p.slice(0, eq).trim().toUpperCase(),
				p
					.slice(eq + 1)
					.trim()
					.toUpperCase(),
			];
		}),
	);
	if (parts.get('FREQ') !== 'YEARLY') return undefined;
	const month = Number(parts.get('BYMONTH') ?? onset.month);
	if (!Number.isInteger(month) || month < 1 || month > 12) return undefined;
	const rule: YearlyRule = { month };
	const day = /^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/u.exec(parts.get('BYDAY') ?? '');
	if (day) {
		rule.weekday = WEEKDAYS.indexOf(day[2] ?? '');
		// A fifth weekday is how some programs say "the last".
		if (day[1] !== undefined) rule.ordinal = Number(day[1]) >= 5 ? -1 : Number(day[1]);
	}
	const setPos = parts.get('BYSETPOS');
	if (setPos !== undefined) {
		// One position, such as -1 with BYDAY=SU for the last Sunday. A list of them would be several
		// changes a year: such a rule is not read, rather than read as another one.
		const position = Number(setPos);
		if (!/^[+-]?\d{1,2}$/u.test(setPos) || position === 0) return undefined;
		rule.setPos = position;
	}
	const monthDays = (parts.get('BYMONTHDAY') ?? '').split(',').filter(Boolean).map(Number);
	if (monthDays.length && monthDays.every((d) => Number.isInteger(d) && d >= 1 && d <= 31))
		rule.monthDays = monthDays;
	// A weekday alone means its first in the month; with BYSETPOS, the one it picks of them all.
	if (rule.ordinal === undefined && rule.monthDays === undefined) {
		if (rule.weekday === undefined) rule.monthDays = [onset.day];
		else rule.monthDays = rule.setPos === undefined ? FIRST_WEEK : MONTH;
	}
	const until = readDateValue(parts.get('UNTIL') ?? '');
	if (until) rule.until = wallAsUtc(until.wall);
	const count = Number(parts.get('COUNT'));
	if (Number.isInteger(count) && count > 0) rule.count = count;
	return rule;
}

function readObservance(c: Component): Observance | null {
	const onset = readDateValue(first(c, 'DTSTART')?.value ?? '');
	const to = readUtcOffset(first(c, 'TZOFFSETTO')?.value ?? '');
	if (!onset || to === null) return null;
	const from = readUtcOffset(first(c, 'TZOFFSETFROM')?.value ?? '') ?? to;
	const rrule = first(c, 'RRULE');
	const rule = rrule ? readYearlyRule(rrule.value, onset.wall) : undefined;
	const dates = c.properties
		.filter((p) => p.name === 'RDATE')
		.flatMap((p) => p.value.split(','))
		.map((v) => readDateValue(v)?.wall)
		.filter((w): w is Wall => w !== undefined);
	return { onset: onset.wall, from, to, ...(rule ? { rule } : {}), dates };
}

/**
 * The observances of a VTIMEZONE, or null when it has no TZID or no readable observance. The TZID
 * property is TEXT (RFC 5545 3.8.3.1), so `Example\, Zone` is the zone a `TZID="Example, Zone"`
 * parameter names: its escapes are decoded.
 */
export function readFileZone(c: Component): FileZone | null {
	const tzid = unescapeText(first(c, 'TZID')?.value ?? '').trim();
	const observances = c.components
		.filter((o) => o.name === 'STANDARD' || o.name === 'DAYLIGHT')
		.map(readObservance)
		.filter((o): o is Observance => o !== null);
	return tzid && observances.length ? { tzid, observances } : null;
}

/** The days of the month a yearly rule finds in `year`, in order, before BYSETPOS picks one. */
function ruleDays(rule: YearlyRule, year: number): number[] {
	if (rule.weekday !== undefined && rule.weekday >= 0 && rule.ordinal !== undefined)
		return rule.ordinal === 0
			? []
			: [nthWeekdayOfMonth(year, rule.month, rule.weekday, rule.ordinal)];
	const length = daysInMonth(year, rule.month);
	return [...new Set(rule.monthDays ?? [])]
		.sort((a, b) => a - b)
		.filter(
			(day) =>
				day <= length &&
				(rule.weekday === undefined ||
					new Date(Date.UTC(year, rule.month - 1, day)).getUTCDay() === rule.weekday),
		);
}

/** The day of the month a yearly rule falls on in `year`, or null. */
function ruleDay(rule: YearlyRule, year: number): number | null {
	const days = ruleDays(rule, year);
	if (rule.setPos === undefined) return days[0] ?? null;
	return days.at(rule.setPos > 0 ? rule.setPos - 1 : rule.setPos) ?? null;
}

/** Every change from the zone's onsets and its rules in the years around `year`, in order. */
function changesAround(zone: FileZone, year: number): Change[] {
	const out: Change[] = [];
	for (const o of zone.observances) {
		const at = (w: Wall): number => wallAsUtc(w) - o.from * MINUTE_MS;
		const start = at(o.onset);
		out.push({ at: start, from: o.from, to: o.to });
		for (const d of o.dates) out.push({ at: at(d), from: o.from, to: o.to });
		const rule = o.rule;
		if (!rule) continue;
		for (const y of [year - 1, year, year + 1]) {
			if (y < o.onset.year || (rule.count !== undefined && y - o.onset.year >= rule.count))
				continue;
			const day = ruleDay(rule, y);
			if (day === null) continue;
			const t = at({ ...o.onset, year: y, month: rule.month, day });
			if (t > start && (rule.until === undefined || t <= rule.until))
				out.push({ at: t, from: o.from, to: o.to });
		}
	}
	return out.sort((a, b) => a.at - b.at);
}

/** Minutes the file's zone is ahead of UTC at an instant. */
export function fileZoneOffset(zone: FileZone, instant: number): number {
	const changes = changesAround(zone, new Date(instant).getUTCFullYear());
	let offset = changes[0]?.from ?? 0;
	for (const c of changes) if (c.at <= instant) offset = c.to;
	return offset;
}

/**
 * The instant of a wall time in the file's zone. A time in a gap moves forward; a repeated hour is
 * the earlier instant in zones behind UTC and the later one in zones ahead of it, as `zonedToUtc`.
 */
export function fileZoneToUtc(zone: FileZone, wall: Wall): number {
	const naive = wallAsUtc(wall);
	const guess = naive - fileZoneOffset(zone, naive) * MINUTE_MS;
	const again = naive - fileZoneOffset(zone, guess) * MINUTE_MS;
	const exact = [guess, again].filter((t) => t + fileZoneOffset(zone, t) * MINUTE_MS === naive);
	return exact.length ? Math.min(...exact) : Math.max(guess, again);
}

/** Common zones, tried before the rest, so a match gets a familiar name. */
const COMMON = [
	'UTC',
	'America/New_York',
	'America/Chicago',
	'America/Denver',
	'America/Phoenix',
	'America/Los_Angeles',
	'America/Anchorage',
	'Pacific/Honolulu',
	'America/Halifax',
	'America/St_Johns',
	'America/Mexico_City',
	'America/Bogota',
	'America/Sao_Paulo',
	'America/Argentina/Buenos_Aires',
	'Europe/London',
	'Europe/Lisbon',
	'Europe/Berlin',
	'Europe/Paris',
	'Europe/Athens',
	'Europe/Helsinki',
	'Europe/Istanbul',
	'Europe/Moscow',
	'Africa/Lagos',
	'Africa/Cairo',
	'Africa/Johannesburg',
	'Africa/Nairobi',
	'Asia/Dubai',
	'Asia/Karachi',
	'Asia/Kolkata',
	'Asia/Dhaka',
	'Asia/Bangkok',
	'Asia/Shanghai',
	'Asia/Singapore',
	'Asia/Tokyo',
	'Asia/Seoul',
	'Australia/Perth',
	'Australia/Adelaide',
	'Australia/Brisbane',
	'Australia/Sydney',
	'Pacific/Auckland',
];

const words = (text: string): string => ` ${text.toLowerCase().replace(/[^a-z0-9]+/gu, ' ')} `;

/** The IANA zone whose offsets and clock changes in `year` are the file zone's, or null. */
export function matchZone(zone: FileZone, year: number): string | null {
	const probes = [Date.UTC(year, 0, 15, 12), Date.UTC(year, 6, 15, 12)];
	const expected = probes.map((t) => fileZoneOffset(zone, t));
	const changes = changesAround(zone, year).filter(
		(c) => c.at >= Date.UTC(year, 0, 1) && c.at < Date.UTC(year + 1, 0, 1) && c.from !== c.to,
	);
	const fits = (candidate: string): boolean =>
		probes.every((t, i) => offsetMinutes(t, candidate) === expected[i]) &&
		changes.every(
			(c) =>
				offsetMinutes(c.at - MINUTE_MS, candidate) === c.from &&
				offsetMinutes(c.at, candidate) === c.to,
		);
	const known =
		typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
	const named = words(zone.tzid);
	const cities = known
		.map((z) => ({ z, at: named.indexOf(words(z.split('/').pop() ?? '')) }))
		.filter((c) => c.at >= 0)
		.sort((a, b) => a.at - b.at)
		.map((c) => c.z);
	for (const candidate of new Set([...cities, ...COMMON, ...known]))
		if (isValidZone(candidate) && fits(candidate)) return candidate;
	return null;
}

/** The zone's own spelling when only the letter case differs (`america/new_york`). */
function spelled(zone: string): string {
	try {
		const resolved = new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions()
			.timeZone;
		return resolved.toLowerCase() === zone.toLowerCase() ? resolved : zone;
	} catch {
		return zone;
	}
}

/** The IANA zone a TZID names, also behind a path prefix (`/mozilla.org/.../Europe/Berlin`). */
export function ianaZone(tzid: string): string | null {
	const name = tzid.trim();
	// Widened: `isValidZone` is a type guard, which would narrow a `string` to `never` below.
	const whole: unknown = name;
	if (isValidZone(whole)) return spelled(whole);
	if (!name.includes('/')) return null;
	const segments = name.split('/').filter(Boolean);
	for (const n of [3, 2, 1]) {
		const tail = segments.slice(-n).join('/');
		if (segments.length >= n && isValidZone(tail)) return spelled(tail);
	}
	return null;
}
