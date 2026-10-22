// The `Intl.DateTimeFormat` of each time zone the calendar reads instants in, kept for reuse:
// making one is slow, and each holds native data. Zone names come from files and stored records,
// and a zone matches however its name is spelt (`america/new_york`), so the formatters are shared
// by the zone's own name and held to `ZONE_FORMATTERS`, the least recently used going first: a
// file that spells one zone a thousand ways, or names a thousand offsets, keeps no more. Not part
// of the area's entry. New code.

/** How many formatters are kept at most. */
export const ZONE_FORMATTERS = 256;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Keeps `f` under `key` as the most recently used, dropping the least recently used past the cap. */
function keep(key: string, f: Intl.DateTimeFormat): Intl.DateTimeFormat {
	formatters.delete(key);
	formatters.set(key, f);
	while (formatters.size > ZONE_FORMATTERS) formatters.delete(formatters.keys().next().value!);
	return f;
}

/** The formatter of `zone`, one per zone whatever the spelling; throws for a zone there is none of. */
export function zoneFormatter(zone: string): Intl.DateTimeFormat {
	const held = formatters.get(zone);
	if (held) return keep(zone, held);
	const made = new Intl.DateTimeFormat('en-US', {
		timeZone: zone,
		hourCycle: 'h23',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
		second: 'numeric',
		weekday: 'short',
	});
	const name = made.resolvedOptions().timeZone;
	const shared = formatters.get(name) ?? made;
	keep(name, shared);
	return name === zone ? shared : keep(zone, shared);
}

/** How many formatters are kept now (for tests). */
export const cachedFormatters = (): number => formatters.size;
