// Where a notebook keeps its documents on the device. The client stores whole Yjs states (one for
// the registry, one per notebook) under string keys and never needs more than this, so a host can
// back it with IndexedDB (the UI's adapter, profile-scoped like the suite), a file, or memory.
// New code.
import * as Y from 'yjs';

export interface NotebookStorage {
	/** The stored bytes under `key`, or `null`. */
	load: (key: string) => Promise<Uint8Array | null>;
	save: (key: string, bytes: Uint8Array) => Promise<void>;
	remove: (key: string) => Promise<void>;
	/** False when what is saved only lasts for this session (memory); omitted means it persists. */
	persistent?: () => boolean;
	/**
	 * Names where the bytes go (an IndexedDB database), so a later client in this tab on the same
	 * storage finds what an earlier one could not save. Omitted, the storage object itself is used.
	 */
	readonly id?: string;
	/**
	 * Replace the bytes under `key` with `change(stored)` in one step, so another client's write on
	 * the same storage cannot come between the read and the write (an IndexedDB transaction does
	 * this across tabs). Omitted, the client reads and then writes, which two clients that cannot
	 * reach each other may interleave.
	 */
	update?: (key: string, change: (stored: Uint8Array | null) => Uint8Array) => Promise<void>;
}

export const REGISTRY_KEY = 'registry';
export const notebookKey = (id: string): string => `notebook:${id}`;

/** In-memory storage (tests, and hosts without persistence). */
export function createMemoryStorage(): NotebookStorage &
	Required<Pick<NotebookStorage, 'update'>> & { readonly keys: () => string[] } {
	const data = new Map<string, Uint8Array>();
	return {
		load: async (key) => data.get(key)?.slice() ?? null,
		save: async (key, bytes) => void data.set(key, bytes.slice()),
		remove: async (key) => void data.delete(key),
		update: async (key, change) =>
			void data.set(key, change(data.get(key)?.slice() ?? null).slice()),
		persistent: () => false,
		keys: () => [...data.keys()],
	};
}

// Copies of what closed notebooks and lists could not save, for this tab's life: per storage (its
// id, else the object) and key.
const byId = new Map<string, Map<string, Uint8Array>>();
const byObject = new WeakMap<NotebookStorage, Map<string, Uint8Array>>();
/** This tab's copies of what a storage refused (notebooks, the list), by key. */
export function tabCopies(storage: NotebookStorage): Map<string, Uint8Array> {
	if (storage.id !== undefined) {
		let map = byId.get(storage.id);
		if (!map) byId.set(storage.id, (map = new Map()));
		return map;
	}
	let map = byObject.get(storage);
	if (!map) byObject.set(storage, (map = new Map()));
	return map;
}

/**
 * Merge `ours` (a Yjs update) into what is stored under `key`: another client on the same storage
 * that cannot reach this one may have saved edits this one does not have. In one step where the
 * storage can; a stored copy that cannot be read fails the merge rather than being written over.
 */
export async function mergeIntoStorage(
	storage: NotebookStorage,
	key: string,
	ours: Uint8Array,
): Promise<void> {
	const merge = (stored: Uint8Array | null): Uint8Array =>
		stored?.length ? Y.mergeUpdates([stored, ours]) : ours;
	if (storage.update) return storage.update(key, merge);
	await storage.save(key, merge(await storage.load(key)));
}
