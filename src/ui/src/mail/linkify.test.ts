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

	it('links a whole address, never only its end', () => {
		const links = (text: string) =>
			linkify(text)
				.filter((s) => s.href)
				.map((s) => s.text);
		// RFC 5322 atext: an apostrophe, an equals sign and the rest belong to the local part.
		expect(links("mail o'connor@example.com now")).toEqual(["o'connor@example.com"]);
		expect(links('a=b@example.com and x#y@example.com')).toEqual([
			'a=b@example.com',
			'x#y@example.com',
		]);
		// Quotes around it are not part of it.
		expect(links("write to 'ada@example.com' or (bob@example.org)!")).toEqual([
			'ada@example.com',
			'bob@example.org',
		]);
		// Where the start of an address cannot be told, nothing is linked rather than a part of it.
		expect(links('d’arcy@example.com')).toEqual([]);
	});

	it('stays fast on long words', () => {
		const started = performance.now();
		linkify('a.'.repeat(100_000));
		linkify(`${'x'.repeat(200_000)}@`);
		expect(performance.now() - started).toBeLessThan(3000);
	});
});
