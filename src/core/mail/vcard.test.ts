import { emptyContact, suggestRecipients, searchContacts, sortContacts } from './contacts';
import { parseVCards, serializeVCards } from './vcard';

// RFC 6350 section 8, as printed (folded lines included).
const RFC_EXAMPLE = [
	'BEGIN:VCARD',
	'VERSION:4.0',
	'FN:Simon Perreault',
	'N:Perreault;Simon;;;ing. jr,M.Sc.',
	'BDAY:--0203',
	'ANNIVERSARY:20090808T1430-0500',
	'GENDER:M',
	'LANG;PREF=1:fr',
	'LANG;PREF=2:en',
	'ORG;TYPE=work:Viagenie',
	'ADR;TYPE=work:;Suite D2-630;2875 Laurier;',
	' Quebec;QC;G1V 2M2;Canada',
	'TEL;VALUE=uri;TYPE="work,voice";PREF=1:tel:+1-418-656-9254;ext=102',
	'TEL;VALUE=uri;TYPE="work,cell,voice,video,text":tel:+1-418-262-6501',
	'EMAIL;TYPE=work:simon.perreault@viagenie.ca',
	'GEO;TYPE=work:geo:46.772673\\,-71.282945',
	'KEY;TYPE=work;VALUE=uri:',
	' http://www.viagenie.ca/simon.perreault/simon.asc',
	'TZ:-0500',
	'URL;TYPE=home:http://nomis80.org',
	'END:VCARD',
].join('\r\n');

describe('parseVCards', () => {
	it('reads the RFC 6350 example', () => {
		const { contacts, skipped } = parseVCards(RFC_EXAMPLE);
		expect(skipped).toBe(0);
		const [simon] = contacts;
		expect(simon).toMatchObject({
			name: 'Simon Perreault',
			familyName: 'Perreault',
			givenName: 'Simon',
			suffix: 'ing. jr,M.Sc.',
			birthday: '--02-03',
			organization: 'Viagenie',
			url: 'http://nomis80.org',
			emails: [{ type: 'work', address: 'simon.perreault@viagenie.ca' }],
			phones: [
				{ type: 'work', number: '+1-418-656-9254;ext=102' },
				{ type: 'cell', number: '+1-418-262-6501' },
			],
			addresses: [
				{
					type: 'work',
					poBox: '',
					extended: 'Suite D2-630',
					street: '2875 Laurier',
					locality: 'Quebec',
					region: 'QC',
					postalCode: 'G1V 2M2',
					country: 'Canada',
				},
			],
		});
		// What the model does not edit is kept verbatim, folded lines joined.
		expect(simon!.extra).toContain(
			'KEY;TYPE=work;VALUE=uri:http://www.viagenie.ca/simon.perreault/simon.asc',
		);
		expect(simon!.extra.some((line) => line.startsWith('GENDER:'))).toBe(true);
	});

	it('reads vCard 3.0 and 2.1 forms', () => {
		const text = [
			'BEGIN:VCARD',
			'VERSION:3.0',
			'UID:abc',
			'FN:Grace Hopper',
			'EMAIL;TYPE=INTERNET,HOME:grace@example.com',
			'item1.TEL;type=CELL:+1 555 0100',
			'END:VCARD',
			'BEGIN:VCARD',
			'VERSION:2.1',
			'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:M=C3=BCller;J=C3=B6rg',
			'TEL;WORK;VOICE:+49 30 1234',
			'NOTE;ENCODING=QUOTED-PRINTABLE:first line=0D=0A=',
			'second line',
			'END:VCARD',
		].join('\n');
		const { contacts } = parseVCards(text);
		expect(contacts[0]).toMatchObject({
			id: 'abc',
			emails: [{ type: 'home', address: 'grace@example.com' }],
			phones: [{ type: 'cell', number: '+1 555 0100' }],
		});
		expect(contacts[1]).toMatchObject({
			familyName: 'Müller',
			givenName: 'Jörg',
			phones: [{ type: 'work', number: '+49 30 1234' }],
			note: 'first line\r\nsecond line',
		});
		expect(contacts[1]!.id).toMatch(/^vcard-1-/);
	});

	it('counts what it cannot read instead of dropping it silently', () => {
		const { contacts, skipped } = parseVCards(
			'garbage\nBEGIN:VCARD\nFN:Half\nBEGIN:VCARD\nFN:Whole\nEND:VCARD\nEND:VCARD\nBEGIN:VCARD\nFN:Open',
		);
		expect(contacts.map((c) => c.name)).toEqual(['Whole']);
		expect(skipped).toBe(4);
	});

	it('gives cards without a UID a stable id', () => {
		const card = 'BEGIN:VCARD\nFN:Ada\nEND:VCARD';
		expect(parseVCards(card).contacts[0]!.id).toBe(parseVCards(card).contacts[0]!.id);
	});
});

describe('serializeVCards', () => {
	it('round-trips every edited field and the verbatim extras', () => {
		const { contacts } = parseVCards(RFC_EXAMPLE);
		const again = parseVCards(serializeVCards(contacts)).contacts;
		expect(again).toEqual(contacts.map((c) => ({ ...c, id: again[0]!.id })));
	});

	it('escapes, folds at 75 octets without splitting characters, and uses CRLF', () => {
		const contact = {
			...emptyContact('u-1', Date.UTC(2026, 0, 5, 9, 0, 0)),
			name: 'Zoë; the "tester", of line\nbreaks',
			note: 'Ünïcödé '.repeat(20),
			emails: [{ type: 'work', address: 'zoe@example.com' }],
		};
		const text = serializeVCards([contact]);
		expect(text).toContain('FN:Zoë\\; the "tester"\\, of line\\nbreaks');
		expect(text).toContain('REV:20260105T090000Z');
		const encoder = new TextEncoder();
		for (const line of text.split('\r\n'))
			expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
		expect(text.replace(/\r\n/g, '')).not.toContain('\n');
		expect(parseVCards(text).contacts[0]).toEqual(contact);
	});
});

describe('address book helpers', () => {
	const ada = {
		...emptyContact('a', 0),
		name: 'Ada Lovelace',
		emails: [{ type: '', address: 'ada@example.com' }],
	};
	const bob = {
		...emptyContact('b', 0),
		name: 'Bob',
		organization: 'Example',
		emails: [{ type: '', address: 'bob@example.org' }],
	};
	it('searches by name, organization and address', () => {
		expect(searchContacts([ada, bob], 'example').map((c) => c.id)).toEqual(['a', 'b']);
		expect(searchContacts([ada, bob], 'love').map((c) => c.id)).toEqual(['a']);
	});
	it('sorts by label', () => {
		expect(sortContacts([bob, ada]).map((c) => c.id)).toEqual(['a', 'b']);
	});
	it('suggests recipients, prefix matches first', () => {
		expect(suggestRecipients([bob, ada], 'b')).toEqual([{ name: 'Bob', email: 'bob@example.org' }]);
		expect(suggestRecipients([ada, bob], 'ex').map((a) => a.email)).toEqual([
			'ada@example.com',
			'bob@example.org',
		]);
	});
});
