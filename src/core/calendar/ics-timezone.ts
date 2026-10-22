// The VTIMEZONE block of an iCalendar file, derived from the platform's IANA data (`Intl`) so no
// time-zone database is bundled. The offset changes from the year before the first event to the
// last year asked for (ten years at least) are read off the clock. When the last eleven of those
// years, or more, repeat the same pair of changes (the "second Sunday of March" kind) the block
// carries two yearly rules from the first of them, which any calendar app extends forever, and
// the changes before it one by one. A zone whose rules differ from year to year (or that has one
// change only) gets each change written out for those years instead. DOM-free. Moved from
// src/core/teams/ics-timezone.ts; the years after the first one are new.
import { DAY_MS, MINUTE_MS, offsetMinutes } from './time-zone';

const CHECKED_YEARS = 10;
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export interface ZoneTransition {
	/** The UTC instant the clocks change. */
	at: number;
	/** Offsets from UTC in minutes, before and after. */
	from: number;
	to: number;
}

const cache = new Map<string, ZoneTransition[]>();

/** The clock changes of one calendar year (UTC bounds), in order. */
export function zoneTransitions(zone: string, year: number): ZoneTransition[] {
	const key = `${zone}|${year}`;
	const hit = cache.get(key);
	if (hit) return hit;
	const out: ZoneTransition[] = [];
	const begin = Date.UTC(year, 0, 1);
	const end = Date.UTC(year + 1, 0, 1);
	let before = offsetMinutes(begin, zone);
	for (let day = begin; day < end; day += DAY_MS) {
		const after = offsetMinutes(day + DAY_MS, zone);
		if (after === before) continue;
		let lo = day;
		let hi = day + DAY_MS;
		while (hi - lo > MINUTE_MS) {
			const mid = Math.floor((lo + hi) / 2 / MINUTE_MS) * MINUTE_MS;
			if (offsetMinutes(mid, zone) === before) lo = mid;
			else hi = mid;
		}
		if (hi < end) out.push({ at: hi, from: before, to: after });
		before = after;
	}
	cache.set(key, out);
	return out;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** `+0100` / `-0430` */
export function icsOffset(minutes: number): string {
	const abs = Math.abs(minutes);
	return `${minutes < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

/** The wall time on the clock just before the change, as `20260308T020000` plus its fields. */
function onset(t: ZoneTransition): { text: string; month: number; day: number; weekday: number } {
	const d = new Date(t.at + t.from * MINUTE_MS);
	return {
		text: `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`,
		month: d.getUTCMonth() + 1,
		day: d.getUTCDate(),
		weekday: d.getUTCDay(),
	};
}

/** `2SU`, or `-1SU` for the last Sunday of the month. */
function nthWeekday(t: ZoneTransition): string {
	const o = onset(t);
	const d = new Date(t.at + t.from * MINUTE_MS);
	const days = new Date(Date.UTC(d.getUTCFullYear(), o.month, 0)).getUTCDate();
	return `${o.day + 7 > days ? -1 : Math.ceil(o.day / 7)}${DAYS[o.weekday]}`;
}

/** What makes two years' changes the same rule. */
const ruleKey = (t: ZoneTransition): string =>
	`${onset(t).month}|${nthWeekday(t)}|${onset(t).text.slice(9)}|${t.from}|${t.to}`;

function name(zone: string, at: number): string {
	try {
		const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
			.formatToParts(new Date(at))
			.find((p) => p.type === 'timeZoneName');
		return parts?.value.replace(/[^\w+:-]/gu, '') ?? '';
	} catch {
		return '';
	}
}

const observance = (
	zone: string,
	t: ZoneTransition,
	start: string,
	rule: string | null,
): string[] => [
	`BEGIN:${t.to > t.from ? 'DAYLIGHT' : 'STANDARD'}`,
	`DTSTART:${start}`,
	`TZOFFSETFROM:${icsOffset(t.from)}`,
	`TZOFFSETTO:${icsOffset(t.to)}`,
	...(name(zone, t.at) ? [`TZNAME:${name(zone, t.at)}`] : []),
	...(rule ? [`RRULE:${rule}`] : []),
	`END:${t.to > t.from ? 'DAYLIGHT' : 'STANDARD'}`,
];

/**
 * Where the yearly rules start among `years` (the changes of consecutive years): the first of the
 * years at the end that each repeat the same pair of changes, when there are more than ten of
 * them; -1 when there are fewer.
 */
function rulesFrom(years: readonly ZoneTransition[][]): number {
	const keys = years.at(-1)?.map(ruleKey) ?? [];
	const repeats = (y: readonly ZoneTransition[]): boolean =>
		keys.length === 2 && y.length === 2 && y.every((t, i) => ruleKey(t) === keys[i]);
	let from = years.length;
	while (from > 0 && repeats(years[from - 1] ?? [])) from--;
	return years.length - from > CHECKED_YEARS ? from : -1;
}

/**
 * The content lines of a VTIMEZONE for an IANA zone, valid from the year before `firstYear`
 * through `lastYear`, and on while the zone keeps the same yearly rules. Every year in between is
 * read off the clock. The result does not depend on the viewer's zone or the current time.
 */
export function vtimezoneLines(zone: string, firstYear: number, lastYear = firstYear): string[] {
	const anchor = firstYear - 1;
	const years = Array.from({ length: Math.max(lastYear - anchor, CHECKED_YEARS) + 1 }, (_, i) =>
		zoneTransitions(zone, anchor + i),
	);
	const head = ['BEGIN:VTIMEZONE', `TZID:${zone}`];
	const tail = ['END:VTIMEZONE'];
	const start = Date.UTC(anchor, 0, 1);
	const base: ZoneTransition = {
		at: start,
		from: offsetMinutes(start, zone),
		to: offsetMinutes(start, zone),
	};
	if (years.every((y) => y.length === 0))
		return [...head, ...observance(zone, base, '19700101T000000', null), ...tail];
	const from = rulesFrom(years);
	const rules = (years[from] ?? []).flatMap((t) => {
		const o = onset(t);
		return observance(zone, t, o.text, `FREQ=YEARLY;BYMONTH=${o.month};BYDAY=${nthWeekday(t)}`);
	});
	if (from === 0) return [...head, ...rules, ...tail];
	// The offset at the start, then every change that is known before the rules (all of them for
	// irregular rules).
	const changes = (from < 0 ? years : years.slice(0, from)).flat();
	return [
		...head,
		...observance(zone, base, '19700101T000000', null),
		...changes.flatMap((t) => observance(zone, t, onset(t).text, null)),
		...rules,
		...tail,
	];
}
