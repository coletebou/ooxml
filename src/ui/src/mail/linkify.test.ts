import { linkify } from './linkify';
import { mailtoDraft } from './mailto';

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
		// A letter written as a base and a combining mark (u and U+0308 for ü) is part of the word.
		expect(links('mail mu\u0308ller@example.com now')).toEqual([]);
	});

	it('links a whole domain, never only its start', () => {
		const links = (text: string) =>
			linkify(text)
				.filter((s) => s.href)
				.map((s) => s.text);
		// A domain goes on past the letters this link reads (RFC 6531): `user@shop.co` would be another.
		expect(links('mail user@shop.coöperatie.nl now')).toEqual([]);
		expect(links('写信给ada@example.com联系')).toEqual([]);
		expect(links('mail user@example.com-ish')).toEqual(['user@example.com-ish']);
		expect(links('mail user@example.co- now')).toEqual([]);
		// Punctuation after it is not part of it.
		expect(links('ada@example.com。 Or ada@example.com, ada@example.com.')).toEqual([
			'ada@example.com',
			'ada@example.com',
			'ada@example.com',
		]);
	});

	it('encodes what a mailto: link may not hold, so the link writes to the address shown', () => {
		// RFC 6068 2: # ? % & = / and the like are percent-encoded in a mailto: address.
		for (const address of [
			'x#y@example.com',
			'a?b@example.com',
			'a%2Bb@example.com',
			'q=r&s@example.com',
		]) {
			const [link] = linkify(address);
			expect(link?.href).toBe(`mailto:${encodeURIComponent(address).replace(/%40/g, '@')}`);
			expect(mailtoDraft(link!.href!)?.to.map((a) => a.email)).toEqual([address]);
		}
	});

	it('stays fast on long words', () => {
		const started = performance.now();
		linkify('a.'.repeat(100_000));
		linkify(`${'x'.repeat(200_000)}@`);
		expect(performance.now() - started).toBeLessThan(3000);
	});
});
