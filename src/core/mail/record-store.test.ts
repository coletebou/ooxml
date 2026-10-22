import { createMemoryRecordStore, type KeyValueStorage } from './record-store';

interface Note {
	id: string;
	text: string;
}

const sanitize = (raw: unknown): Note | null => {
	const value = raw as Partial<Note> | null;
	return typeof value?.id === 'string' && typeof value.text === 'string'
		? { id: value.id, text: value.text }
		: null;
};

/** A storage in memory whose writes fail while `full` is set, as a full or disabled one does. */
const storage = () => {
	const entries = new Map<string, string>();
	const held = {
		full: false,
		getItem: (key: string) => entries.get(key) ?? null,
		setItem: (key: string, value: string) => {
			if (held.full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
			entries.set(key, value);
		},
		stored: () => JSON.parse(entries.get('notes') ?? '[]') as Note[],
	};
	return held;
};

const store = (backing?: KeyValueStorage, seed?: Note[]) =>
	createMemoryRecordStore<Note>({
		key: 'notes',
		sanitize,
		...(backing ? { storage: backing } : {}),
		...(seed ? { seed } : {}),
	});

describe('createMemoryRecordStore', () => {
	it('keeps a change the storage refused for the session, and says it was not stored', async () => {
		const backing = storage();
		const notes = store(backing);
		await notes.save({ id: 'a', text: 'Kept' });
		backing.full = true;
		await expect(notes.save({ id: 'b', text: 'Only in memory' })).rejects.toMatchObject({
			code: 'storage',
		});
		expect(await notes.list()).toEqual([
			{ id: 'a', text: 'Kept' },
			{ id: 'b', text: 'Only in memory' },
		]);
		await expect(notes.remove('a')).rejects.toMatchObject({ code: 'storage' });
		expect(await notes.list()).toEqual([{ id: 'b', text: 'Only in memory' }]);
		expect(backing.stored()).toEqual([{ id: 'a', text: 'Kept' }]);
		// The next write the storage takes stores everything the session holds.
		backing.full = false;
		await notes.save({ id: 'c', text: 'Stored' });
		expect(backing.stored()).toEqual([
			{ id: 'b', text: 'Only in memory' },
			{ id: 'c', text: 'Stored' },
		]);
	});

	it('applies each change to what the storage holds, so another tab keeps its changes', async () => {
		// Two tabs (or the suite and the Mail app) open the same address book.
		const backing = storage();
		const first = store(backing);
		const second = store(backing);
		await first.save({ id: 'a', text: 'From the first' });
		await second.save({ id: 'b', text: 'From the second' });
		await second.save({ id: 'c', text: 'To remove' });
		const third = store(backing);
		await first.remove('c');
		await third.save({ id: 'd', text: 'From the third' });
		const all = [
			{ id: 'a', text: 'From the first' },
			{ id: 'b', text: 'From the second' },
			{ id: 'd', text: 'From the third' },
		];
		expect(backing.stored()).toEqual(all);
		expect(await second.list()).toEqual(all);
		// A change the storage refused still holds, over what another tab stores meanwhile.
		backing.full = true;
		await expect(first.save({ id: 'e', text: 'Only in memory' })).rejects.toMatchObject({
			code: 'storage',
		});
		backing.full = false;
		await second.save({ id: 'f', text: 'Stored meanwhile' });
		expect(await first.list()).toEqual([
			...all,
			{ id: 'f', text: 'Stored meanwhile' },
			{ id: 'e', text: 'Only in memory' },
		]);
		await first.remove('a');
		expect(backing.stored()).toEqual([
			{ id: 'b', text: 'From the second' },
			{ id: 'd', text: 'From the third' },
			{ id: 'f', text: 'Stored meanwhile' },
			{ id: 'e', text: 'Only in memory' },
		]);
	});

	it('stores what a working storage takes, and reads it back', async () => {
		const backing = storage();
		const notes = store(backing, [{ id: 'seed', text: 'Seeded' }]);
		expect(await notes.save({ id: 'a', text: 'Saved' })).toEqual({ id: 'a', text: 'Saved' });
		await notes.remove('seed');
		expect(backing.stored()).toEqual([{ id: 'a', text: 'Saved' }]);
		expect(await store(backing, [{ id: 'seed', text: 'Seeded' }]).list()).toEqual([
			{ id: 'a', text: 'Saved' },
		]);
		// Without a storage, nothing is stored and nothing fails.
		const memory = store();
		await memory.save({ id: 'a', text: 'In memory' });
		expect(await memory.list()).toEqual([{ id: 'a', text: 'In memory' }]);
	});

	it('starts from the seed when the storage cannot be read', async () => {
		const unreadable: KeyValueStorage = {
			getItem: () => {
				throw new DOMException('Access is denied.', 'SecurityError');
			},
			setItem: () => undefined,
		};
		expect(await store(unreadable, [{ id: 'seed', text: 'Seeded' }]).list()).toEqual([
			{ id: 'seed', text: 'Seeded' },
		]);
		const garbled: KeyValueStorage = { getItem: () => '{not json', setItem: () => undefined };
		expect(await store(garbled, [{ id: 'seed', text: 'Seeded' }]).list()).toEqual([
			{ id: 'seed', text: 'Seeded' },
		]);
		// What cannot be a record is dropped; the rest is read.
		const mixed: KeyValueStorage = {
			getItem: () => JSON.stringify([{ id: 'a', text: 'Read' }, { id: 1 }, null]),
			setItem: () => undefined,
		};
		expect(await store(mixed, [{ id: 'seed', text: 'Seeded' }]).list()).toEqual([
			{ id: 'a', text: 'Read' },
		]);
	});
});
