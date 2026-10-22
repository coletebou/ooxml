import { parseSearch } from '../search';
import { toJmapFilter, toUtcDate } from './filter';

describe('toJmapFilter', () => {
	it('has no filter for an empty query and a bare condition for one', () => {
		expect(toJmapFilter({})).toBeNull();
		// The RFC 8621 4.10 example's filter.
		expect(toJmapFilter({ mailboxId: 'fb666a55' })).toEqual({ inMailbox: 'fb666a55' });
	});

	it('makes one condition per word of a field and combines them with AND', () => {
		expect(toJmapFilter({ mailboxId: 'inbox', subject: 'q3 plan', text: 'report' })).toEqual({
			operator: 'AND',
			conditions: [
				{ inMailbox: 'inbox' },
				{ text: 'report' },
				{ subject: 'q3' },
				{ subject: 'plan' },
			],
		});
	});

	it('looks for `to` in To, Cc and Bcc, as the memory transport does', () => {
		expect(toJmapFilter({ to: 'grace' })).toEqual({
			operator: 'OR',
			conditions: [{ to: 'grace' }, { cc: 'grace' }, { bcc: 'grace' }],
		});
	});

	it('maps unread and flagged to keyword conditions', () => {
		expect(toJmapFilter({ unread: true })).toEqual({ notKeyword: '$seen' });
		expect(toJmapFilter({ unread: false })).toEqual({ hasKeyword: '$seen' });
		expect(toJmapFilter({ flagged: true })).toEqual({ hasKeyword: '$flagged' });
		expect(toJmapFilter({ flagged: false })).toEqual({ notKeyword: '$flagged' });
	});

	it('sends before and after as UTCDates', () => {
		expect(
			toJmapFilter({ after: Date.UTC(2026, 0, 5), before: Date.UTC(2026, 0, 6, 12, 30, 15, 250) }),
		).toEqual({
			operator: 'AND',
			conditions: [{ before: '2026-01-06T12:30:15.250Z' }, { after: '2026-01-05T00:00:00Z' }],
		});
	});

	it('translates a parsed search box', () => {
		const query = parseSearch(
			'from:ada subject:"q3 plan" has:attachment is:unread is:flagged before:2026-02-01 report',
		);
		expect(toJmapFilter({ ...query, mailboxId: 'MB1' })).toEqual({
			operator: 'AND',
			conditions: [
				{ inMailbox: 'MB1' },
				{ text: 'report' },
				{ from: 'ada' },
				{ subject: 'q3' },
				{ subject: 'plan' },
				{ hasAttachment: true },
				{ notKeyword: '$seen' },
				{ hasKeyword: '$flagged' },
				{ before: '2026-02-01T00:00:00Z' },
			],
		});
		expect(toJmapFilter(parseSearch('body:invoice is:read'))).toEqual({
			operator: 'AND',
			conditions: [{ body: 'invoice' }, { hasKeyword: '$seen' }],
		});
	});
});

describe('toUtcDate', () => {
	it('omits zero fractional seconds (RFC 8620 1.4) and refuses what is not a time', () => {
		expect(toUtcDate(Date.UTC(2014, 9, 30, 6, 12))).toBe('2014-10-30T06:12:00Z');
		expect(toUtcDate(Date.UTC(2014, 9, 30, 6, 12, 0, 5))).toBe('2014-10-30T06:12:00.005Z');
		expect(() => toUtcDate(Number.NaN)).toThrow(expect.objectContaining({ code: 'invalid' }));
	});
});
