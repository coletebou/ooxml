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
