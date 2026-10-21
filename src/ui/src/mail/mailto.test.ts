import { mailtoDraft } from './mailto';

describe('mailtoDraft', () => {
	it('reads the addresses, subject and body of a link', () => {
		expect(
			mailtoDraft('MAILTO:ada@example.com, bob@example.com?subject=Hi%20there&body=See%0Ayou'),
		).toEqual({
			to: [
				{ name: '', email: 'ada@example.com' },
				{ name: '', email: 'bob@example.com' },
			],
			subject: 'Hi there',
			text: 'See\nyou',
		});
	});

	it('keeps an escaped comma inside its address and a broken escape as written', () => {
		expect(mailtoDraft('mailto:%22a%2Cb%22@example.com,%zz@example.com?body=100%')?.to).toEqual([
			{ name: '', email: '"a,b"@example.com' },
			{ name: '', email: '%zz@example.com' },
		]);
		expect(mailtoDraft('mailto:x@example.com?body=100%')?.text).toBe('100%');
	});

	it('starts nothing for another kind of link or none at all', () => {
		expect(mailtoDraft('https://example.com/a')).toBeNull();
		expect(mailtoDraft('not a link')).toBeNull();
	});
});
