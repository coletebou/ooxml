// A small keyed store for the address book and the calendar: in memory, seeded, and optionally
// persisted as one JSON entry in a `Storage`-like object. Everything read back from storage is
// re-validated, because storage is shared with other code and may be stale or edited. New code.
import { MailTransportError } from './transport';

/**
 * Records by id. A change the store keeps but cannot persist (its storage is full or turned off)
 * rejects with a `MailTransportError` of code `storage`; the change holds for the session.
 */
export interface RecordStore<T extends { id: string }> {
	list(): Promise<T[]>;
	/** Adds or replaces the record with the same id. */
	save(record: T): Promise<T>;
	remove(id: string): Promise<void>;
}

/** What a store can persist to: `localStorage`, or any object with the two methods. */
export interface KeyValueStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export interface MemoryStoreOptions<T> {
	seed?: readonly T[];
	storage?: KeyValueStorage;
	key?: string;
}

/**
 * A store seeded with `seed`, or with what `storage` holds under `key` once anything was saved.
 * A storage that cannot be read leaves the seed. A write it refuses (quota, storage turned off)
 * keeps the change in memory, so the store still works for the session, and `save` or `remove`
 * rejects with a `storage` error, so that the person can be told; the next write it takes stores
 * every record again.
 */
export function createMemoryRecordStore<T extends { id: string }>(
	options: MemoryStoreOptions<T> & { key: string; sanitize: (raw: unknown) => T | null },
): RecordStore<T> {
	let records = new Map<string, T>();
	let loaded = false;
	try {
		const text = options.storage?.getItem(options.key);
		if (text) {
			const parsed: unknown = JSON.parse(text);
			if (Array.isArray(parsed))
				for (const item of parsed) {
					const record = options.sanitize(item);
					if (record) records.set(record.id, record);
				}
			loaded = true;
		}
	} catch {
		records = new Map();
	}
	if (!loaded) for (const record of options.seed ?? []) records.set(record.id, record);
	const persist = (): void => {
		try {
			options.storage?.setItem(options.key, JSON.stringify([...records.values()]));
		} catch (cause) {
			throw new MailTransportError(
				'storage',
				'The change is kept in memory only: the storage did not take it.',
				{ cause },
			);
		}
	};
	return {
		list: async () => [...records.values()],
		async save(record) {
			records.set(record.id, record);
			persist();
			return record;
		},
		async remove(id) {
			records.delete(id);
			persist();
		},
	};
}
