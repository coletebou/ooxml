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

	it('fails a save whose transaction aborts after the write request succeeded', async () => {
		const real = new IDBFactory();
		let abortNext = false;
		// The write request succeeds, then the transaction aborts (as a quota or disk error at commit).
		const factory = {
			open: (name: string, version?: number) => {
				const request = real.open(name, version);
				request.addEventListener('success', () => {
					const db = request.result;
					const transaction = db.transaction.bind(db);
					db.transaction = ((stores: string, mode?: IDBTransactionMode) => {
						const tx = transaction(stores, mode);
						if (mode !== 'readwrite' || !abortNext) return tx;
						abortNext = false;
						const store = tx.objectStore(stores);
						const put = store.put.bind(store);
						store.put = (value: unknown, key?: IDBValidKey) => {
							const written = put(value, key);
							written.addEventListener('success', () => tx.abort());
							return written;
						};
						tx.objectStore = () => store;
						return tx;
					}) as IDBDatabase['transaction'];
				});
				return request;
			},
		} as unknown as IDBFactory;
		const storage = createIndexedDbStorage('test-abort', factory);
		await storage.save('k', new Uint8Array([1]));
		abortNext = true;
		await expect(storage.save('k', new Uint8Array([2]))).rejects.toThrow();
		expect(await storage.load('k')).toEqual(new Uint8Array([1]));
		storage.close();
	});

	it('keeps working in memory without IndexedDB', async () => {
		const storage = createIndexedDbStorage('none', null);
		await storage.save('k', new Uint8Array([4]));
		expect(await storage.load('k')).toEqual(new Uint8Array([4]));
		expect(storage.persistent()).toBe(false);
	});

	it('keeps memory-only notebooks for the tab under one database name', async () => {
		const name = `memory-${Math.random().toString(36).slice(2)}`;
		await createIndexedDbStorage(name, null).save('k', new Uint8Array([5]));
		expect(await createIndexedDbStorage(name, null).load('k')).toEqual(new Uint8Array([5]));
		expect(await createIndexedDbStorage(`${name}-other`, null).load('k')).toBeNull();
	});

	it('lets another tab delete or upgrade the database while it is open', async () => {
		const factory = new IDBFactory();
		const storage = createIndexedDbStorage('test-notebooks-versionchange', factory);
		await storage.save('registry', new Uint8Array([1]));
		const outcome = await new Promise<string>((resolve) => {
			const request = factory.deleteDatabase('test-notebooks-versionchange');
			request.onsuccess = () => resolve('deleted');
			request.onblocked = () => resolve('blocked');
		});
		expect(outcome).toBe('deleted');
		// What this tab saves afterwards fails, rather than recreating the deleted database.
		await expect(storage.save('registry', new Uint8Array([2]))).rejects.toThrow();
	});

	it('updates a key in one step, so two tabs saving at once keep both changes', async () => {
		const factory = new IDBFactory();
		const tabA = createIndexedDbStorage('test-notebooks-update', factory);
		const tabB = createIndexedDbStorage('test-notebooks-update', factory);
		await tabA.save('registry', new Uint8Array([0]));
		const append = (byte: number) => (stored: Uint8Array | null) =>
			new Uint8Array([...(stored ?? []), byte]);
		await Promise.all([tabA.update('registry', append(1)), tabB.update('registry', append(2))]);
		const stored = [...((await tabA.load('registry')) ?? [])];
		expect(stored.sort()).toEqual([0, 1, 2]);
		// A change that throws fails the update and leaves what is stored.
		await expect(
			tabB.update('registry', () => {
				throw new Error('cannot merge');
			}),
		).rejects.toThrow('cannot merge');
		expect((await tabA.load('registry'))?.length).toBe(3);
		tabA.close();
		tabB.close();
	});
});
