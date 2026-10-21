import { parseVCards } from './vcard';
import { parseLine, unfold } from './vcard-lines';

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
