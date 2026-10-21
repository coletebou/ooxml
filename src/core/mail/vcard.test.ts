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
		// Without a UID, the id comes from the card's text, not from where it stands in the file.
		expect(contacts[1]!.id).toMatch(/^vcard-[0-9a-f]{16}$/);
	});

	it('keeps every website, note, title, organization and name of a card that has several', () => {
		// RFC 6350 allows any number of each (FN at least one): the first that says something fills
		// the contact, and each other is kept as read.
		const text = [
			'BEGIN:VCARD',
			'VERSION:4.0',
			'UID:many',
			'FN:Ada Lovelace',
			'FN;LANGUAGE=fr:Ada Lovelace, comtesse',
			'URL;TYPE=home:https://ada.example',
			'URL;TYPE=work:https://work.example/ada',
			'NOTE:',
			'NOTE:First note',
			'NOTE:Second note',
			'TITLE:Countess',
			'TITLE:Analyst',
			'ORG:;',
			'ORG:Analytical Society;Engines',
			'ORG:Royal Society',
			'END:VCARD',
		].join('\r\n');
		const [card] = parseVCards(text).contacts;
		expect(card).toMatchObject({
			name: 'Ada Lovelace',
			url: 'https://ada.example',
			note: 'First note',
			title: 'Countess',
			organization: 'Analytical Society',
			organizationUnits: ['Engines'],
		});
		expect(card!.extra).toEqual([
			'FN;LANGUAGE=fr:Ada Lovelace, comtesse',
			'URL;TYPE=work:https://work.example/ada',
			'NOTE:Second note',
			'TITLE:Analyst',
			'ORG:Royal Society',
		]);
		// Written out and read again, nothing is lost and nothing changes places.
		expect(parseVCards(serializeVCards([card!])).contacts).toEqual([card]);
	});

	it('reads a quoted-printable soft line break as the line after it, white space included', () => {
		const card = (version: string, ...lines: string[]): string =>
			['BEGIN:VCARD', `VERSION:${version}`, 'UID:qp', ...lines, 'END:VCARD'].join('\r\n');
		// RFC 2045 6.7 (5): an `=` ending the line goes, and the next line follows as it is.
		const [legacy] = parseVCards(
			card('2.1', 'NOTE;ENCODING=QUOTED-PRINTABLE:hello=', ' world, and=', '=0D=0Aon'),
		).contacts;
		expect(legacy?.note).toBe('hello world, and\r\non');
		// Only a quoted-printable value breaks that way, whatever the text of another one says.
		const [plain] = parseVCards(
			card('3.0', 'NOTE:set ENCODING=QUOTED-PRINTABLE and end with =', 'TEL:+1 555 0100'),
		).contacts;
		expect(plain).toMatchObject({
			note: 'set ENCODING=QUOTED-PRINTABLE and end with =',
			phones: [{ type: '', number: '+1 555 0100' }],
		});
		// A last line that ends in `=` does not take the end of its card with it.
		const { contacts, skipped } = parseVCards(card('2.1', 'NOTE;ENCODING=QUOTED-PRINTABLE:a=3D='));
		expect([contacts[0]?.note, skipped]).toEqual(['a==', 0]);
	});

	it('reads a quoted-printable line another program left in a 4.0 card, folded the 4.0 way', () => {
		// 4.0 folds with a space after any character: here right after the `=` of `=41`.
		const kept = `X-NOTE;ENCODING=QUOTED-PRINTABLE:${'a'.repeat(41)}=41b`;
		const text = [
			'BEGIN:VCARD',
			'VERSION:4.0',
			'UID:u-1',
			'FN:Ada',
			kept.slice(0, 75),
			` ${kept.slice(75)}`,
			'END:VCARD',
		].join('\r\n');
		const { contacts } = parseVCards(text);
		expect(contacts[0]?.extra).toEqual([kept]);
		// Written out again, it is the text it encodes.
		expect(serializeVCards(contacts)).toContain(`\r\nX-NOTE:${'a'.repeat(41)}Ab\r\n`);
	});

	it('writes the quoted-printable lines a 2.1 card kept as the 4.0 text they encode', () => {
		const [card] = parseVCards(
			[
				'BEGIN:VCARD',
				'VERSION:2.1',
				'UID:qp',
				'FN:Ada',
				'NOTE;ENCODING=QUOTED-PRINTABLE:first=20note',
				'NOTE;ENCODING=QUOTED-PRINTABLE:next=20call=0D=0Aline two',
				'ROLE;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:B=C3=BCroleitung',
				'END:VCARD',
			].join('\r\n'),
		).contacts;
		const text = serializeVCards([card!]);
		expect(text).not.toMatch(/ENCODING|CHARSET|=20|=C3/u);
		expect(text.split('\r\n')).toEqual(
			expect.arrayContaining(['NOTE:first note', 'NOTE:next call\\nline two', 'ROLE:Büroleitung']),
		);
		// Read again, the card says the same.
		expect(parseVCards(text).contacts[0]).toMatchObject({
			note: 'first note',
			extra: ['NOTE:next call\\nline two', 'ROLE:Büroleitung'],
		});
	});

	it('counts what it cannot read instead of dropping it silently', () => {
		const { contacts, skipped } = parseVCards(
			'garbage\nBEGIN:VCARD\nFN:Half\nBEGIN:VCARD\nFN:Whole\nEND:VCARD\nEND:VCARD\nBEGIN:VCARD\nFN:Open',
		);
		expect(contacts.map((c) => c.name)).toEqual(['Whole']);
		expect(skipped).toBe(4);
	});

	it('reads the first card of a file that starts with a byte order mark', () => {
		const card = 'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Ada Lovelace\r\nEND:VCARD\r\n';
		const { contacts, skipped } = parseVCards(`\uFEFF${card}${card.replace('Ada', 'Grace')}`);
		expect(contacts.map((c) => c.name)).toEqual(['Ada Lovelace', 'Grace Lovelace']);
		expect(skipped).toBe(0);
	});

	it('gives cards without a UID a stable id', () => {
		const card = 'BEGIN:VCARD\nFN:Ada\nEND:VCARD';
		expect(parseVCards(card).contacts[0]!.id).toBe(parseVCards(card).contacts[0]!.id);
	});

	it('gives a card without a UID the same id wherever it stands, and one contact for two copies', () => {
		const ada = 'BEGIN:VCARD\r\nFN:Ada\r\nEMAIL:ada@example.com\r\nEND:VCARD\r\n';
		const bob = 'BEGIN:VCARD\r\nFN:Bob\r\nEND:VCARD\r\n';
		const ids = (text: string): string[] => parseVCards(text).contacts.map((c) => c.id);
		const [adaId, bobId] = ids(ada + bob);
		expect(adaId).toMatch(/^vcard-[0-9a-f]{16}$/);
		// A file reordered, or a part of it, brings the same contacts again, not copies of them.
		expect(ids(bob + ada)).toEqual([bobId, adaId]);
		expect(ids(bob)).toEqual([bobId]);
		expect(parseVCards(ada + ada + bob)).toMatchObject({
			contacts: [{ name: 'Ada' }, { name: 'Bob' }],
			skipped: 0,
		});
		// Folding does not change a card.
		expect(ids('BEGIN:VCARD\r\nFN:A\r\n da\r\nEMAIL:ada@example.com\r\nEND:VCARD\r\n')).toEqual([
			adaId,
		]);
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

	it('writes a UID that is not a URI as text, and reads both forms back', () => {
		const urn = 'urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6';
		const text = serializeVCards([
			{ ...emptyContact('contact-1', 0), name: 'Ada' },
			{ ...emptyContact('a;b,c', 0), name: 'Grace' },
			{ ...emptyContact(urn, 0), name: 'Mary' },
		]);
		expect(text).toContain('\r\nUID;VALUE=text:contact-1\r\n');
		expect(text).toContain('\r\nUID;VALUE=text:a\\;b\\,c\r\n');
		expect(text).toContain(`\r\nUID:${urn}\r\n`);
		expect(parseVCards(text).contacts.map((c) => c.id)).toEqual(['contact-1', 'a;b,c', urn]);
	});

	it('writes a lone carriage return as a line break of the value, never one that ends the line', () => {
		// Quoted-printable `=0D` reads as a lone CR, which a reader takes for the end of a line.
		const [card] = parseVCards(
			[
				'BEGIN:VCARD',
				'VERSION:2.1',
				'UID:keep',
				'NOTE;ENCODING=QUOTED-PRINTABLE:one=0Dtwo=0DUID:other',
				'ADR;ENCODING=QUOTED-PRINTABLE:;;Main St=0DFloor 2;Town;;;',
				'ORG;ENCODING=QUOTED-PRINTABLE:Example=0DLabs',
				'END:VCARD',
			].join('\r\n'),
		).contacts;
		expect(card).toMatchObject({
			id: 'keep',
			note: 'one\rtwo\rUID:other',
			organization: 'Example\rLabs',
		});
		const text = serializeVCards([card!]);
		expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
		expect(parseVCards(text)).toEqual({
			contacts: [
				{
					...card,
					note: 'one\ntwo\nUID:other',
					organization: 'Example\nLabs',
					addresses: [{ ...card!.addresses[0], street: 'Main St\nFloor 2' }],
				},
			],
			skipped: 0,
		});
	});

	it('writes no line break from a stored type or a birthday that is not a date', () => {
		const contact = {
			...emptyContact('u-1', 0),
			name: 'Ada',
			birthday: 'circa\r\nUID:other',
			emails: [{ type: 'work\r\nUID:other', address: 'ada@example.com' }],
		};
		const text = serializeVCards([contact]);
		expect(text.split('\r\n')).toEqual(
			expect.arrayContaining(['EMAIL:ada@example.com', 'BDAY;VALUE=text:circa\\nUID:other']),
		);
		expect(parseVCards(text).contacts.map((c) => c.id)).toEqual(['u-1']);
	});

	it('writes the URL as the URI it is: without text escapes or line breaks', () => {
		const contact = {
			...emptyContact('u-1', 0),
			name: 'Ada',
			url: 'https://example.com/a;b,c?q=1,2',
		};
		const text = serializeVCards([contact]);
		expect(text).toContain('\r\nURL:https://example.com/a;b,c?q=1,2\r\n');
		expect(parseVCards(text).contacts[0]?.url).toBe(contact.url);
		const broken = serializeVCards([{ ...contact, url: 'https://example.com/\r\nUID:x\n/next' }]);
		expect(broken).toContain('\r\nURL:https://example.com/UID:x/next\r\n');
		// A backslash, which no URI holds and a reader of text escapes would read as one, is encoded.
		const local = serializeVCards([{ ...contact, url: 'file:///C:/new\\notes' }]);
		expect(local).toContain('\r\nURL:file:///C:/new%5Cnotes\r\n');
		expect(parseVCards(local).contacts[0]?.url).toBe('file:///C:/new%5Cnotes');
	});

	it('escapes the commas of an organization, whose components are single values', () => {
		const contact = {
			...emptyContact('u-1', 0),
			name: 'Ada',
			organization: 'ABC, Inc.',
			organizationUnits: ['North, South', 'Marketing'],
		};
		const text = serializeVCards([contact]);
		expect(text).toContain('\r\nORG:ABC\\, Inc.;North\\, South;Marketing\r\n');
		expect(parseVCards(text).contacts[0]).toEqual(contact);
	});

	it('writes a vCard 3 or 2.1 inline photo, logo, sound or key as a vCard 4 data URI', () => {
		const { contacts } = parseVCards(
			[
				'BEGIN:VCARD',
				'VERSION:3.0',
				'UID:pictures',
				'FN:Pictures',
				'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQ',
				'item1.LOGO;TYPE=image/png;ENCODING=BASE64;X-SIZE=4:iVBO',
				' Rw0K',
				'SOUND;TYPE=WAVE;ENCODING=b:UklGRg==',
				'KEY;ENCODING=B;TYPE=X509:MIIC',
				'PHOTO;VALUE=uri:https://example.com/a.jpg',
				'END:VCARD',
				'BEGIN:VCARD',
				'VERSION:2.1',
				'UID:old',
				'PHOTO;JPEG;ENCODING=BASE64:',
				'  /9j/4AAQ',
				'  SkZJRg==',
				'',
				'END:VCARD',
			].join('\r\n'),
		);
		const text = serializeVCards(contacts);
		const lines = text.replace(/\r\n /g, '').split('\r\n');
		expect(lines).toEqual(
			expect.arrayContaining([
				'PHOTO:data:image/jpeg;base64,/9j/4AAQ',
				'item1.LOGO;X-SIZE=4:data:image/png;base64,iVBORw0K',
				'SOUND:data:audio/wav;base64,UklGRg==',
				'KEY:data:application/pkix-cert;base64,MIIC',
				'PHOTO;VALUE=uri:https://example.com/a.jpg',
				'PHOTO:data:image/jpeg;base64,/9j/4AAQSkZJRg==',
			]),
		);
		expect(text).not.toMatch(/ENCODING/i);
		// Read back, the cards keep the vCard 4 lines, so a second export writes the same text.
		expect(serializeVCards(parseVCards(text).contacts)).toBe(text);
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
