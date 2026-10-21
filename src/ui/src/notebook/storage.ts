// The notebook's documents on this device, in IndexedDB: one object store of Yjs states under
// string keys (`registry`, `notebook:<id>`), in a database a host names per profile (the suite
// passes a profile-scoped name, as it does for its other stores). Without IndexedDB (a blocked or
// private window) the notebook keeps working in memory and says so.
import { type NotebookStorage, createMemoryStorage } from 'ooxml-core/notebook';
import { safeStorage } from '../safe-storage';

export const DEFAULT_NOTEBOOK_DATABASE = 'ooxml-notebooks';
const STORE = 'documents';

export interface IndexedDbStorage extends NotebookStorage {
	/** False when IndexedDB was unavailable and documents live in memory only. */
	readonly persistent: () => boolean;
	close: () => void;
}

const wrap = <T>(request: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
	});

const memories = new Map<string, NotebookStorage>();

export function createIndexedDbStorage(
	name: string = DEFAULT_NOTEBOOK_DATABASE,
	/** The IndexedDB to use; omitted means the browser's, `null` means none (memory only). */
	idb?: IDBFactory | null,
): IndexedDbStorage {
	const factory = idb === undefined ? globalThis.indexedDB : (idb ?? undefined);
	// Without IndexedDB the notebooks live in memory for the tab: a new client (the app moved in
	// the DOM, another user name) finds them again under the same database name.
	const memory = memories.get(name) ?? createMemoryStorage();
	memories.set(name, memory);
	let persistent = !!factory;
	let db: Promise<IDBDatabase | null> | null = null;
	const open = (): Promise<IDBDatabase | null> =>
		(db ??= new Promise<IDBDatabase | null>((resolve) => {
			if (!factory) return resolve(null);
			try {
				const request = factory.open(name, 1);
				request.onupgradeneeded = () => {
					if (!request.result.objectStoreNames.contains(STORE))
						request.result.createObjectStore(STORE);
				};
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => resolve(null);
				request.onblocked = () => resolve(null);
			} catch {
				resolve(null);
			}
		}).then((opened) => {
			if (!opened) persistent = false;
			return opened;
		}));
	const run = async <T>(
		mode: IDBTransactionMode,
		fn: (store: IDBObjectStore) => IDBRequest<T>,
	): Promise<T | undefined> => {
		const opened = await open();
		if (!opened) return undefined;
		const tx = opened.transaction(STORE, mode);
		const result = wrap(fn(tx.objectStore(STORE)));
		if (mode === 'readonly') return result;
		// A write can still fail at commit (quota, disk): it only counts once the transaction is done.
		const committed = new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
		});
		const [value] = await Promise.all([result, committed]);
		return value;
	};
	return {
		async load(key) {
			if (!persistent) return memory.load(key);
			const value = await run('readonly', (store) => store.get(key));
			if (value instanceof Uint8Array) return value;
			if (value instanceof ArrayBuffer) return new Uint8Array(value);
			return persistent ? null : memory.load(key);
		},
		async save(key, bytes) {
			if (!persistent || !(await open())) return memory.save(key, bytes);
			await run('readwrite', (store) => store.put(bytes, key));
		},
		async remove(key) {
			await memory.remove(key);
			if (persistent) await run('readwrite', (store) => store.delete(key));
		},
		persistent: () => persistent,
		close() {
			void db?.then((opened) => opened?.close());
			db = null;
		},
	};
}

/** This browser's notebook user id, made once and remembered (authorship and presence). */
export function notebookUserId(): string {
	const key = 'notebook:user-id';
	const known = safeStorage.getItem(key);
	if (known && /^[\w-]{4,64}$/u.test(known)) return known;
	const made = `u${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
	safeStorage.setItem(key, made);
	return made;
}
