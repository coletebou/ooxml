import { createMemoryContactStore, emptyContact, sanitizeContact } from './contacts';
import type { KeyValueStorage } from './record-store';
import { parseVCards, serializeVCards } from './vcard';

const memoryStorage = (): KeyValueStorage => {
	const entries = new Map<string, string>();
	return {
		getItem: (key) => entries.get(key) ?? null,
		setItem: (key, value) => void entries.set(key, value),
	};
};

describe('sanitizeContact', () => {
	it('keeps a long property the model does not edit whole', () => {
		const photo = `PHOTO:data:image/jpeg;base64,${'A'.repeat(100_000)}`;
		const contact = { ...emptyContact('c1', 0), name: 'Ada', extra: [photo, 'X-NICK:Countess'] };
		expect(sanitizeContact(JSON.parse(JSON.stringify(contact)))?.extra).toEqual([
			photo,
			'X-NICK:Countess',
		]);
	});

	it('drops kept lines that would break the card apart on export', () => {
		const contact = {
			...emptyContact('c1', 0),
			extra: [
				'X-A:1',
				'X-B:2\r\nEND:VCARD',
				'X-C:3\nBEGIN:VCARD',
				'END:VCARD',
				'begin;x=1:vcard',
				'',
			],
		};
		expect(sanitizeContact(contact)?.extra).toEqual(['X-A:1']);
	});

	it('keeps an imported photo through storage and export', async () => {
		const storage = memoryStorage();
		const photo = `PHOTO:data:image/jpeg;base64,${'Q'.repeat(10_000)}`;
		const card = `BEGIN:VCARD\r\nVERSION:4.0\r\nUID:c1\r\nFN:Ada\r\n${photo}\r\nEND:VCARD\r\n`;
		const [contact] = parseVCards(card).contacts;
		await createMemoryContactStore({ storage }).save(contact!);
		const [stored] = await createMemoryContactStore({ storage }).list();
		expect(stored?.extra).toEqual([photo]);
		expect(parseVCards(serializeVCards([stored!])).contacts[0]?.extra).toEqual([photo]);
	});
});
