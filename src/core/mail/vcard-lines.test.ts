import { decodeBase64, encodeBase64 } from '../digest/base64';
import { parseVCards, serializeVCards } from './vcard';
import { decodeValue, parseLine, unfold } from './vcard-lines';

describe('decodeValue', () => {
	const value = (line: string): string => decodeValue(parseLine(line)!);

	it('reads a quoted-printable value without a charset as UTF-8 when it is, else as Latin-1', () => {
		// vCard 2.1 writes 8-bit text in the charset of the program that wrote it, and old cards
		// often do not say which: as for a MIME body without one, UTF-8 when valid, else windows-1252.
		expect(value('FN;ENCODING=QUOTED-PRINTABLE:Andr=E9')).toBe('André');
		expect(value('FN;ENCODING=QUOTED-PRINTABLE:Andr=C3=A9')).toBe('André');
		expect(value('NOTE;ENCODING=QUOTED-PRINTABLE:=80 5, =93quoted=94')).toBe('€ 5, “quoted”');
	});

	it('reads a quoted-printable value in the charset it names', () => {
		expect(value('FN;CHARSET=ISO-8859-1;ENCODING=QUOTED-PRINTABLE:Andr=C3=A9')).toBe('AndrÃ©');
		expect(value('FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Andr=E9')).toBe('Andr�');
		expect(value('FN;CHARSET=WINDOWS-1251;ENCODING=QUOTED-PRINTABLE:=C0=ED=ED=E0')).toBe('Анна');
		expect(value('FN;CHARSET=ISO-8859-2;ENCODING=QUOTED-PRINTABLE:=B5uba')).toBe('ľuba');
		// A value that is not quoted-printable is the text as read.
		expect(value('FN;CHARSET=ISO-8859-1:Andr=E9')).toBe('Andr=E9');
	});
});

describe('parseLine', () => {
	it('keeps every value of a repeated parameter, in the order written', () => {
		expect(parseLine('TEL;TYPE=work;PREF=1;type="voice,cell";CELL:tel:+1-555-0100')).toMatchObject({
			name: 'TEL',
			params: { TYPE: ['work', 'voice,cell', 'CELL'], PREF: ['1'] },
			value: 'tel:+1-555-0100',
		});
		expect(parseLine('NOTE;X-P=a;X-Q=z;X-P=b,c;X-P="d,e":text')?.params).toEqual({
			'X-P': ['a', 'b', 'c', 'd,e'],
			'X-Q': ['z'],
		});
	});

	it('reads a card with a hundred thousand repeated parameters on a line in linear time', () => {
		const line = `NOTE${';X-P=a'.repeat(100_000)}:Call after six`;
		const card = ['BEGIN:VCARD', 'VERSION:4.0', 'FN:Ada', line, 'END:VCARD', ''].join('\r\n');
		const started = performance.now();
		const { contacts, skipped } = parseVCards(card);
		const elapsed = performance.now() - started;
		expect(skipped).toBe(0);
		expect(contacts.map((contact) => [contact.name, contact.note])).toEqual([
			['Ada', 'Call after six'],
		]);
		// Each repeat used to copy every value before it, five billion copies for each of the two
		// times the line is read; now it is milliseconds. Generous, so a loaded runner does not flake.
		expect(elapsed).toBeLessThan(2000);
	});
});

describe('unfold', () => {
	it('joins a quoted-printable value broken over fifty thousand lines in linear time', () => {
		// vCard 2.1 breaks a long quoted-printable value with an `=` at the end of each line; this
		// one is about 3.5 MB.
		const text = 'Call after six, or leave a message. '.repeat(2);
		const lines = Array.from({ length: 50_000 }, () => `${text}=`);
		const card = [
			'BEGIN:VCARD',
			'VERSION:2.1',
			'FN:Ada',
			`NOTE;ENCODING=QUOTED-PRINTABLE:${lines.join('\r\n')}`,
			'Done',
			'END:VCARD',
			'',
		].join('\r\n');
		const started = performance.now();
		const { contacts, skipped } = parseVCards(card);
		const elapsed = performance.now() - started;
		expect(skipped).toBe(0);
		expect(contacts[0]?.note).toBe(`${text.repeat(50_000)}Done`);
		// Each break used to copy the whole value joined so far; generous, so a loaded runner does
		// not flake.
		expect(elapsed).toBeLessThan(2000);
	});

	it('reads a 2.1 base64 value that goes on in lines without indent, to a blank line', () => {
		// vCard 2.1 writers break a long base64 value into lines of their own, which end with a blank
		// line; some indent them, some do not.
		const bytes = Uint8Array.from({ length: 120 }, (_, i) => (i * 37) % 256);
		const lines = encodeBase64(bytes).match(/.{1,40}/g)!;
		const card = (photo: string, starts: boolean, ...after: string[]): string =>
			[
				'BEGIN:VCARD',
				'VERSION:2.1',
				'UID:photo',
				'N:Lovelace;Ada',
				...(starts ? [`${photo}${lines[0]}`, ...lines.slice(1)] : [photo, ...lines]),
				...after,
				'TEL;WORK:+44 20 7946 0000',
				'END:VCARD',
			].join('\r\n');
		const texts = [
			card('PHOTO;ENCODING=BASE64;TYPE=JPEG:', true, ''),
			card('PHOTO;TYPE=JPEG;ENCODING=B:', false, ''),
			card('PHOTO;JPEG;BASE64:', false, ''),
			// The next property right after the value, without the blank line, starts a line of its own.
			card('PHOTO;ENCODING=BASE64;TYPE=JPEG:', true),
		];
		for (const text of texts) {
			const { contacts, skipped } = parseVCards(text);
			expect([skipped, contacts.length]).toEqual([0, 1]);
			expect(contacts[0]).toMatchObject({
				familyName: 'Lovelace',
				phones: [{ type: 'work', number: '+44 20 7946 0000' }],
			});
			// Written as 4.0, the photo is every byte it was.
			const written = serializeVCards(contacts).replace(/\r\n /g, '');
			const data = /\r\nPHOTO:data:image\/jpeg;base64,([^\r]*)\r\n/.exec(written)?.[1];
			expect(decodeBase64(data ?? '')).toEqual(bytes);
		}
	});

	it('still drops only the `=` of a soft break and keeps a folded line as it is', () => {
		expect(
			unfold(
				[
					'BEGIN:VCARD',
					'VERSION:2.1',
					'NOTE;ENCODING=QUOTED-PRINTABLE:One=',
					'Two=',
					' three',
					'END:VCARD',
					'BEGIN:VCARD',
					'VERSION:4.0',
					'NOTE:Four',
					' five=',
					' six',
					'END:VCARD',
				].join('\r\n'),
			),
		).toEqual([
			'BEGIN:VCARD',
			'VERSION:2.1',
			'NOTE;ENCODING=QUOTED-PRINTABLE:OneTwo three',
			'END:VCARD',
			'BEGIN:VCARD',
			'VERSION:4.0',
			'NOTE:Fourfive=six',
			'END:VCARD',
		]);
	});
});
