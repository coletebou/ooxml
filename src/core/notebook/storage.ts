// Where a notebook keeps its documents on the device. The client stores whole Yjs states (one for
// the registry, one per notebook) under string keys and never needs more than this, so a host can
// back it with IndexedDB (the UI's adapter, profile-scoped like the suite), a file, or memory.
// New code.

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
}

export const REGISTRY_KEY = 'registry';
export const notebookKey = (id: string): string => `notebook:${id}`;

/** In-memory storage (tests, and hosts without persistence). */
export function createMemoryStorage(): NotebookStorage & { readonly keys: () => string[] } {
	const data = new Map<string, Uint8Array>();
	return {
		load: async (key) => data.get(key)?.slice() ?? null,
		save: async (key, bytes) => void data.set(key, bytes.slice()),
		remove: async (key) => void data.delete(key),
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
