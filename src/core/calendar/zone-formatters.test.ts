import { isValidZone, zonedParts } from './time-zone';
import { cachedFormatters, ZONE_FORMATTERS } from './zone-formatters';

describe('the formatters of time zones', () => {
	it('keeps one per zone however a file spells it, and never more than it can hold', () => {
		// Zones match without regard to case: a file can spell one zone thousands of ways.
		const spellings = Array.from({ length: 2000 }, (_, i) =>
			[...'america/new_york'].map((c, j) => ((i >> j) & 1 ? c.toUpperCase() : c)).join(''),
		);
		const at = Date.UTC(2026, 9, 22, 12);
		const parts = zonedParts(at, 'America/New_York');
		for (const zone of new Set(spellings)) {
			expect(isValidZone(zone)).toBe(true);
			expect(zonedParts(at, zone)).toEqual(parts);
		}
		expect(cachedFormatters()).toBeLessThanOrEqual(ZONE_FORMATTERS);
		// Offsets are zones too, each its own: still bounded.
		for (let minutes = -720; minutes <= 840; minutes++) {
			const sign = minutes < 0 ? '-' : '+';
			const m = Math.abs(minutes);
			isValidZone(
				`${sign}${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
			);
		}
		expect(cachedFormatters()).toBeLessThanOrEqual(ZONE_FORMATTERS);
	});
});
