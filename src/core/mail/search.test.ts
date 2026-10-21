import {
	bodyText,
	decodeEntities,
	dropScriptsAndStyles,
	isSearch,
	matchesQuery,
	parseSearch,
} from './search';
import { summary } from './test-support/emails';

describe('parseSearch', () => {
	it('reads fields, flags, dates and free text', () => {
		expect(
			parseSearch(
				'from:ada subject:"q3 plan" has:attachment is:unread is:flagged before:2026-01-10 report',
			),
		).toEqual({
			from: 'ada',
			subject: 'q3 plan',
			hasAttachment: true,
			unread: true,
			flagged: true,
			before: Date.UTC(2026, 0, 10),
			text: 'report',
		});
	});
	it('combines repeated fields and keeps unknown fields as text', () => {
		expect(parseSearch('to:ben to:carter foo:bar')).toEqual({ to: 'ben carter', text: 'foo:bar' });
		expect(parseSearch('is:read after:not-a-date')).toEqual({
			unread: false,
			text: 'after:not-a-date',
		});
	});
	it('tells a search from a plain folder query', () => {
		expect(isSearch({ mailboxId: 'inbox' })).toBe(false);
		expect(isSearch({ mailboxId: 'inbox', text: 'x' })).toBe(true);
	});
});

describe('matchesQuery', () => {
	const email = {
		...summary('a', {
			subject: 'Q3 Plan review',
			from: { name: 'Ada Lovelace', email: 'ada@example.com' },
			keywords: { $flagged: true },
			hasAttachment: true,
		}),
		text: 'The roadmap is attached.',
	};
	it('matches each field case-insensitively and needs every word', () => {
		expect(matchesQuery(email, { from: 'LOVELACE' })).toBe(true);
		expect(matchesQuery(email, { subject: 'plan q3' })).toBe(true);
		expect(matchesQuery(email, { subject: 'plan budget' })).toBe(false);
		expect(matchesQuery(email, { body: 'roadmap' })).toBe(true);
		expect(matchesQuery(email, { text: 'ada roadmap' })).toBe(true);
	});
	it('matches flags, mailbox and dates', () => {
		expect(matchesQuery(email, { unread: true, flagged: true, hasAttachment: true })).toBe(true);
		expect(matchesQuery(email, { mailboxId: 'archive' })).toBe(false);
		expect(matchesQuery(email, { before: email.receivedAt })).toBe(false);
		expect(matchesQuery(email, { after: email.receivedAt })).toBe(true);
	});
});

describe('body text', () => {
	it('drops scripts and styles in one pass and decodes entities', () => {
		expect(dropScriptsAndStyles('a<script>x</script>b<STYLE>y</style>c<script>never closed')).toBe(
			'a b c ',
		);
		expect(decodeEntities('&amp; &lt;b&gt; &#65;&#x42; &bogus; &#0;')).toBe(
			'& <b> AB &bogus; &#0;',
		);
		expect(bodyText({ html: '<p>Hello&nbsp;<b>you</b></p><script>bad()</script>' }).trim()).toBe(
			'Hello you',
		);
	});
	it('stays linear on hostile markup', () => {
		const started = performance.now();
		dropScriptsAndStyles('<script'.repeat(50_000));
		expect(performance.now() - started).toBeLessThan(2000);
	});
	it('stays linear on many closed blocks of one kind and none of the other', () => {
		for (const block of ['<script>x</script>', '<style>x</style>']) {
			const started = performance.now();
			expect(dropScriptsAndStyles(`a${block.repeat(50_000)}b`)).toBe(`a${' '.repeat(50_000)}b`);
			expect(performance.now() - started).toBeLessThan(2000);
		}
	});
});
