import { linkify } from './linkify';

describe('linkify', () => {
	it('splits plain text into text and links, never markup', () => {
		expect(
			linkify('See https://example.com/a?b=1. Or www.example.org, or mail ada@example.com!'),
		).toEqual([
			{ text: 'See ' },
			{ text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
			{ text: '. Or ' },
			{ text: 'www.example.org', href: 'https://www.example.org' },
			{ text: ', or mail ' },
			{ text: 'ada@example.com', href: 'mailto:ada@example.com' },
			{ text: '!' },
		]);
		expect(linkify('<b>not markup</b>')).toEqual([{ text: '<b>not markup</b>' }]);
	});

	it('stays fast on long words', () => {
		const started = performance.now();
		linkify('a.'.repeat(100_000));
		linkify(`${'x'.repeat(200_000)}@`);
		expect(performance.now() - started).toBeLessThan(3000);
	});
});
