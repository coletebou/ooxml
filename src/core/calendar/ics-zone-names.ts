// Which IANA zone an imported iCalendar file's TZID names: one the platform knows, also behind a
// path prefix such as `/mozilla.org/20050126_1/Europe/Berlin`. A repeat in a zone that names none
// (a display name such as `W. Europe Standard Time`) keeps its time in the IANA zone whose clock
// changes match the file's own VTIMEZONE in the event's year (a city named in the TZID first, then
// a short list of common zones, then every zone the platform knows). DOM-free. New code.
import { type FileZone, fileZoneChanges, fileZoneOffset } from './ics-read-zone';
import { MINUTE_MS, isValidZone, offsetMinutes } from './time-zone';

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
	const changes = fileZoneChanges(zone, year).filter(
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
