// The part of an iCalendar RRULE (RFC 5545 section 3.3.10) that a `RecurringSeries` holds:
// FREQ=DAILY, WEEKLY, MONTHLY or YEARLY with COUNT or UNTIL; a weekly rule on the start's own
// weekday; a monthly rule on the start's date (BYMONTHDAY) or on its weekday by an ordinal (BYDAY
// such as `3TU` or `-1FR`, or one weekday with BYSETPOS); a yearly rule on the start's month and
// date (one on a date with no month repeats every month: a monthly rule). Anything else (an
// INTERVAL above 1, several days, BYWEEKNO, BYSETPOS lists, a rule out of step with its start)
// is refused with a reason, and the caller imports the event as its first occurrence. WKST only
// matters for what is refused, so it is ignored. DOM-free. New code.
import type { MonthlyBy, Repeat } from './model';
import { WEEKDAY_ORDINALS, dayMatchesOrdinal } from './recurrence-calendar';

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const FREQS: Record<string, Repeat> = {
	DAILY: 'daily',
	WEEKLY: 'weekly',
	MONTHLY: 'monthly',
	YEARLY: 'yearly',
};
const UNITS: Record<string, string> = {
	DAILY: 'days',
	WEEKLY: 'weeks',
	MONTHLY: 'months',
	YEARLY: 'years',
};
/** The rule parts read (or, for WKST, safely ignored); any other part refuses the rule. */
const KNOWN_PARTS = new Set([
	'FREQ',
	'INTERVAL',
	'COUNT',
	'UNTIL',
	'WKST',
	'BYDAY',
	'BYMONTHDAY',
	'BYMONTH',
	'BYSETPOS',
]);

/** The start's wall date in the event's zone. */
export interface RuleStart {
	year: number;
	month: number;
	day: number;
	/** 0 = Sunday. */
	weekday: number;
}

export type ReadRule =
	| {
			repeat: Repeat;
			monthlyBy?: MonthlyBy;
			ordinal?: number;
			count?: number;
			/** The UNTIL value as written, for the caller to read in the event's zone. */
			until?: string;
	  }
	| { refused: string };

/** A RRULE value as a series, or the reason it cannot be one. */
export function readRule(value: string, start: RuleStart): ReadRule {
	const parts = new Map<string, string>();
	for (const part of value.split(';')) {
		if (!part.trim()) continue;
		const eq = part.indexOf('=');
		const key = part.slice(0, eq).trim().toUpperCase();
		if (eq <= 0 || parts.has(key)) return { refused: `has an unreadable repeat rule (${value})` };
		const partValue = part.slice(eq + 1).trim();
		// UNTIL is handed back as written (see `ReadRule`); the other values are keywords.
		parts.set(key, key === 'UNTIL' ? partValue : partValue.toUpperCase());
	}
	const freq = parts.get('FREQ') ?? '';
	const repeat = FREQS[freq];
	if (!repeat)
		return {
			refused: ['SECONDLY', 'MINUTELY', 'HOURLY'].includes(freq)
				? `repeats ${freq.toLowerCase()}`
				: `has a repeat rule with FREQ=${freq || '(none)'}`,
		};
	const interval = parts.get('INTERVAL');
	if (interval !== undefined && Number(interval) !== 1)
		return { refused: `repeats every ${interval} ${UNITS[freq] ?? ''}`.trim() };
	if (parts.has('COUNT') && parts.has('UNTIL')) return { refused: 'has both COUNT and UNTIL' };
	const count = parts.has('COUNT') ? Number(parts.get('COUNT')) : undefined;
	if (count !== undefined && (!Number.isInteger(count) || count < 1))
		return { refused: `has COUNT=${parts.get('COUNT')}` };
	const byday = parts.get('BYDAY');
	const bymonthday = parts.get('BYMONTHDAY');
	const bymonth = parts.get('BYMONTH');
	const bysetpos = parts.get('BYSETPOS');
	for (const key of parts.keys()) if (!KNOWN_PARTS.has(key)) return { refused: `uses ${key}` };
	if (byday?.includes(',')) return { refused: `repeats on several days (BYDAY=${byday})` };
	if (bymonthday?.includes(','))
		return { refused: `repeats on several dates (BYMONTHDAY=${bymonthday})` };
	if (bymonth?.includes(',')) return { refused: `repeats in several months (BYMONTH=${bymonth})` };
	const day = byday === undefined ? null : /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/u.exec(byday);
	if (byday !== undefined && (!day || WEEKDAYS.indexOf(day[2] ?? '') !== start.weekday))
		return { refused: `repeats on ${byday}, which is not the weekday it starts on` };
	if (bymonthday !== undefined && Number(bymonthday) !== start.day)
		return { refused: `repeats on day ${bymonthday}, which is not the date it starts on` };
	if (bymonth !== undefined && Number(bymonth) !== start.month)
		return { refused: `repeats in month ${bymonth}, which is not the month it starts in` };
	const end = {
		...(count !== undefined ? { count } : {}),
		...(parts.has('UNTIL') ? { until: parts.get('UNTIL') ?? '' } : {}),
	};
	if (freq === 'DAILY' && (byday || bymonthday || bymonth || bysetpos))
		return { refused: `repeats daily with BY rules (${value})` };
	if (freq === 'WEEKLY' && (day?.[1] || bymonthday || bymonth || bysetpos))
		return { refused: `repeats weekly with BY rules (${value})` };
	if (freq === 'YEARLY' && (byday || bysetpos))
		return { refused: `repeats yearly on a weekday (${value})` };
	// BYMONTHDAY without BYMONTH expands a yearly rule to every month of the year (RFC 5545
	// 3.3.10): the same dates as a monthly rule on that day, which is what the series holds.
	if (freq === 'YEARLY' && bymonthday && !bymonth) return { repeat: 'monthly', ...end };
	if (freq === 'MONTHLY') {
		if (bymonth) return { refused: `repeats monthly in one month (${value})` };
		if (day) {
			// `3TU`, or `TU` with BYSETPOS=3: the same rule.
			const written = day[1] ?? bysetpos;
			const ordinal = written === undefined ? NaN : Number(written);
			if ((day[1] && bysetpos) || !WEEKDAY_ORDINALS.includes(ordinal))
				return { refused: `repeats monthly on ${bysetpos ? `${byday} at ${bysetpos}` : byday}` };
			if (bymonthday) return { refused: `repeats monthly on a weekday and a date (${value})` };
			if (!dayMatchesOrdinal(start.year, start.month, start.day, ordinal))
				return { refused: `repeats on ${byday}, which is not the day it starts on` };
			return { repeat, monthlyBy: 'weekday', ordinal, ...end };
		}
		if (bysetpos) return { refused: `uses BYSETPOS without a weekday (${value})` };
	}
	return { repeat, ...end };
}
