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
 * Each change is made to what the storage holds when it is made, and `list` reads it again, so two
 * stores on one storage (two tabs, or the suite and the Mail app) keep each other's changes. A
 * storage that cannot be read leaves what the store holds (the seed at first). A write it refuses
 * (quota, storage turned off) keeps the change in memory, so the store still works for the
 * session, and `save` or `remove` rejects with a `storage` error, so that the person can be told;
 * such changes hold over what the storage gives, and the next write it takes stores them too.
 */
export function createMemoryRecordStore<T extends { id: string }>(
	options: MemoryStoreOptions<T> & { key: string; sanitize: (raw: unknown) => T | null },
): RecordStore<T> {
	/** What the storage holds, or null when it holds nothing yet or cannot be read. */
	const stored = (): Map<string, T> | null => {
		try {
			const text = options.storage?.getItem(options.key);
			if (!text) return null;
			const parsed: unknown = JSON.parse(text);
			if (!Array.isArray(parsed)) return null;
			const out = new Map<string, T>();
			for (const item of parsed) {
				const record = options.sanitize(item);
				if (record) out.set(record.id, record);
			}
			return out;
		} catch {
			return null;
		}
	};
	let records = stored() ?? new Map((options.seed ?? []).map((record) => [record.id, record]));
	/** The changes the storage refused, by id (null: removed), applied over what it holds. */
	const unstored = new Map<string, T | null>();
	/** What the storage holds now, with the changes it refused. */
	const current = (): Map<string, T> => {
		const out = stored() ?? records;
		for (const [id, record] of unstored)
			if (record) out.set(id, record);
			else out.delete(id);
		return out;
	};
	const change = (id: string, record: T | null): void => {
		records = current();
		if (record) records.set(id, record);
		else records.delete(id);
		unstored.set(id, record);
		try {
			options.storage?.setItem(options.key, JSON.stringify([...records.values()]));
		} catch (cause) {
			throw new MailTransportError(
				'storage',
				'The change is kept in memory only: the storage did not take it.',
				{ cause },
			);
		}
		unstored.clear();
	};
	return {
		async list() {
			records = current();
			return [...records.values()];
		},
		async save(record) {
			change(record.id, record);
			return record;
		},
		async remove(id) {
			change(id, null);
		},
	};
}
