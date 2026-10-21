import { parseVCards } from './vcard';
import { parseLine } from './vcard-lines';

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
