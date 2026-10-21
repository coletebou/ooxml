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

	it('keeps a plus sign in the subject and body as written, an escaped one decoded', () => {
		// RFC 6068 escapes with percent signs only: a plus sign is itself, never a space.
		expect(mailtoDraft('mailto:ada@example.com?subject=C++&body=1+1')).toMatchObject({
			subject: 'C++',
			text: '1+1',
		});
		expect(mailtoDraft('mailto:ada@example.com?subject=C%2B%2B&body=1%2B1%3D2')).toMatchObject({
			subject: 'C++',
			text: '1+1=2',
		});
	});

	it('reads the subject and body fields whatever the case of their names, the first of each', () => {
		expect(mailtoDraft('mailto:ada@example.com?Subject=Hi&BODY=There&subject=Again')).toEqual({
			to: [{ name: '', email: 'ada@example.com' }],
			subject: 'Hi',
			text: 'There',
		});
		expect(mailtoDraft('mailto:ada@example.com?sub%6Aect=Hi&body')).toMatchObject({
			subject: 'Hi',
			text: '',
		});
	});

	it('keeps a field with a broken escape as written, the others decoded', () => {
		expect(mailtoDraft('mailto:x@example.com?subject=50%25%zz&body=See%20you')).toMatchObject({
			subject: '50%25%zz',
			text: 'See you',
		});
		expect(mailtoDraft('mailto:x@example.com?subject=%E0%A4%A&body=%')).toMatchObject({
			subject: '%E0%A4%A',
			text: '%',
		});
	});

	it('starts nothing for another kind of link or none at all', () => {
		expect(mailtoDraft('https://example.com/a')).toBeNull();
		expect(mailtoDraft('not a link')).toBeNull();
	});
});
