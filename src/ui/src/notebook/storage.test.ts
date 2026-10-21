import { IDBFactory } from 'fake-indexeddb';
import { createIndexedDbStorage } from './storage';

describe('notebook IndexedDB storage', () => {
	it('keeps bytes per key in its own database and removes them', async () => {
		const factory = new IDBFactory();
		const storage = createIndexedDbStorage('test-notebooks', factory);
		expect(await storage.load('registry')).toBeNull();
		await storage.save('registry', new Uint8Array([1, 2, 3]));
		await storage.save('notebook:a', new Uint8Array([9]));
		expect(await storage.load('registry')).toEqual(new Uint8Array([1, 2, 3]));
		// Another profile's database does not see it.
		const other = createIndexedDbStorage('test-notebooks-p2', factory);
		expect(await other.load('registry')).toBeNull();
		await storage.remove('notebook:a');
		expect(await storage.load('notebook:a')).toBeNull();
		expect(storage.persistent()).toBe(true);
		storage.close();
		other.close();
		// A new connection reads what was saved.
		const reopened = createIndexedDbStorage('test-notebooks', factory);
		expect(await reopened.load('registry')).toEqual(new Uint8Array([1, 2, 3]));
		reopened.close();
	});

	it('keeps working in memory without IndexedDB', async () => {
		const storage = createIndexedDbStorage('none', null);
		await storage.save('k', new Uint8Array([4]));
		expect(await storage.load('k')).toEqual(new Uint8Array([4]));
		expect(storage.persistent()).toBe(false);
	});
});
