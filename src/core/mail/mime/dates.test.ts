import { formatDate, parseDate } from './dates';

describe('parseDate', () => {
	it('reads RFC 5322 date-times (A.1.1, A.1.2)', () => {
		expect(parseDate('Fri, 21 Nov 1997 09:55:06 -0600')).toBe(Date.UTC(1997, 10, 21, 15, 55, 6));
		expect(parseDate('Tue, 1 Jul 2003 10:52:37 +0200')).toBe(Date.UTC(2003, 6, 1, 8, 52, 37));
	});

	it('reads folded white space and comments (A.5)', () => {
		const value =
			'Thu,\r\n      13\r\n        Feb\r\n          1969\r\n      23:32\r\n               -0330 (Newfoundland Time)';
		expect(parseDate(value)).toBe(Date.UTC(1969, 1, 14, 3, 2, 0));
	});

	it('reads the obsolete forms of A.6.2, A.6.3 and section 4.3', () => {
		expect(parseDate('21 Nov 97 09:55:06 GMT')).toBe(Date.UTC(1997, 10, 21, 9, 55, 6));
		expect(parseDate('Fri, 21 Nov 1997 09(comment):   55  :  06 -0600')).toBe(
			Date.UTC(1997, 10, 21, 15, 55, 6),
		);
		expect(parseDate('Mon, 5 Jan 26 09:00 EST')).toBe(Date.UTC(2026, 0, 5, 14, 0, 0));
		expect(parseDate('5 Jan 103 09:00:00 +0000')).toBe(Date.UTC(2003, 0, 5, 9));
		const zones: Array<[string, number]> = [
			['UT', 0],
			['GMT', 0],
			['EST', -5],
			['EDT', -4],
			['CST', -6],
			['CDT', -5],
			['MST', -7],
			['MDT', -6],
			['PST', -8],
			['PDT', -7],
		];
		for (const [zone, hours] of zones)
			expect(parseDate(`Mon, 05 Jan 2026 09:00:00 ${zone}`)).toBe(Date.UTC(2026, 0, 5, 9 - hours));
	});

	it('reads military, unknown and -0000 zones as no offset (section 4.3)', () => {
		for (const zone of ['A', 'z', 'CEST', '-0000', '+0000'])
			expect(parseDate(`Mon, 05 Jan 2026 09:00:00 ${zone}`)).toBe(Date.UTC(2026, 0, 5, 9));
	});

	it('reads the other forms mail programs write', () => {
		expect(parseDate('Mon Jan  5 09:00:00 2026')).toBe(Date.UTC(2026, 0, 5, 9));
		expect(parseDate('Monday, 05-Jan-26 09:00:00 GMT')).toBe(Date.UTC(2026, 0, 5, 9));
		expect(parseDate('2026-01-05T09:00:00Z')).toBe(Date.UTC(2026, 0, 5, 9));
		expect(parseDate('2026-01-05 10:30:00 +01:00')).toBe(Date.UTC(2026, 0, 5, 9, 30));
		expect(parseDate('5 January 2026 9:00 PM +0000')).toBe(Date.UTC(2026, 0, 5, 21));
		expect(parseDate('Sat, 10 Jan 2026 12:00 AM -0500')).toBe(Date.UTC(2026, 0, 10, 5));
		expect(parseDate('05 Jan 2026 09:00:60 +0000')).toBe(Date.UTC(2026, 0, 5, 9, 0, 59));
		expect(parseDate('Mon, 05 Jan 2026 09:00:00')).toBe(Date.UTC(2026, 0, 5, 9));
	});

	it('gives undefined for what is not a date', () => {
		for (const value of [
			undefined,
			'',
			'not a date',
			'31 Feb 2026 10:00 +0000',
			'05 Foo 2026 10:00 +0000',
			'Mon, 05 Jan 2026 25:00:00 +0000',
			'Jan 2026',
		])
			expect(parseDate(value)).toBeUndefined();
	});
});

describe('formatDate', () => {
	it('writes RFC 5322 date-times in the zone asked for', () => {
		expect(formatDate(Date.UTC(2026, 0, 5, 9))).toBe('Mon, 05 Jan 2026 09:00:00 +0000');
		expect(formatDate(Date.UTC(2026, 0, 5, 9), 120)).toBe('Mon, 05 Jan 2026 11:00:00 +0200');
		expect(formatDate(Date.UTC(1997, 10, 21, 15, 55, 6), -360)).toBe(
			'Fri, 21 Nov 1997 09:55:06 -0600',
		);
		expect(formatDate(Date.UTC(1969, 1, 14, 3, 2), -210)).toBe('Thu, 13 Feb 1969 23:32:00 -0330');
		expect(formatDate(Date.UTC(2026, 0, 5, 9, 0, 0, 999))).toBe('Mon, 05 Jan 2026 09:00:00 +0000');
	});

	it('writes what parseDate reads back', () => {
		const at = Date.UTC(2026, 9, 20, 21, 42, 7);
		for (const offset of [0, 330, -480, 765]) expect(parseDate(formatDate(at, offset))).toBe(at);
	});

	it('rejects a time that is not finite', () => {
		expect(() => formatDate(Number.NaN)).toThrow(RangeError);
		expect(() => formatDate(8.64e15 + 1)).toThrow(RangeError);
	});
});
