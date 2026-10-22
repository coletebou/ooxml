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
	update: NonNullable<NotebookStorage['update']>;
	close: () => void;
}

const wrap = <T>(request: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
	});

/** The browser's IndexedDB; reading it throws where storage is blocked (some third-party frames). */
function browserIndexedDb(): IDBFactory | undefined {
	try {
		return globalThis.indexedDB;
	} catch {
		return undefined;
	}
}

const memories = new Map<string, ReturnType<typeof createMemoryStorage>>();

export function createIndexedDbStorage(
	name: string = DEFAULT_NOTEBOOK_DATABASE,
	/** The IndexedDB to use; omitted means the browser's, `null` means none (memory only). */
	idb?: IDBFactory | null,
): IndexedDbStorage {
	const factory = idb === undefined ? browserIndexedDb() : (idb ?? undefined);
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
				request.onsuccess = () => {
					// Another tab upgrading or deleting the database is not blocked by this one: the
					// connection closes, and what is saved after that fails and says so.
					request.result.onversionchange = () => request.result.close();
					resolve(request.result);
				};
				request.onerror = () => resolve(null);
				request.onblocked = () => resolve(null);
			} catch {
				resolve(null);
			}
		}).then((opened) => {
			if (!opened) persistent = false;
			return opened;
		}));
	/** A write transaction that counts only once it is done (quota or disk can fail it at commit). */
	const commit = (tx: IDBTransaction): Promise<void> =>
		new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
		});
	const bytesOf = (value: unknown): Uint8Array | null =>
		value instanceof Uint8Array
			? value
			: value instanceof ArrayBuffer
				? new Uint8Array(value)
				: null;
	const run = async <T>(
		mode: IDBTransactionMode,
		fn: (store: IDBObjectStore) => IDBRequest<T>,
	): Promise<T | undefined> => {
		const opened = await open();
		if (!opened) return undefined;
		const tx = opened.transaction(STORE, mode);
		const result = wrap(fn(tx.objectStore(STORE)));
		if (mode === 'readonly') return result;
		const [value] = await Promise.all([result, commit(tx)]);
		return value;
	};
	return {
		async load(key) {
			if (!persistent) return memory.load(key);
			const value = bytesOf(await run('readonly', (store) => store.get(key)));
			return value ?? (persistent ? null : memory.load(key));
		},
		async save(key, bytes) {
			if (!persistent || !(await open())) return memory.save(key, bytes);
			await run('readwrite', (store) => store.put(bytes, key));
		},
		async update(key, change) {
			const opened = persistent ? await open() : null;
			if (!opened) return memory.update(key, change);
			// Read and write in one transaction, so another tab's save cannot come between them; the
			// write is queued from the read's own event, while the transaction is still active.
			const tx = opened.transaction(STORE, 'readwrite');
			const store = tx.objectStore(STORE);
			const done = commit(tx);
			const read = store.get(key);
			let failed: unknown = null;
			read.onsuccess = () => {
				try {
					store.put(change(bytesOf(read.result)), key);
				} catch (error) {
					failed = error;
					tx.abort();
				}
			};
			await done.catch((error: unknown) => {
				throw failed ?? error;
			});
		},
		async remove(key) {
			await memory.remove(key);
			if (persistent) await run('readwrite', (store) => store.delete(key));
		},
		persistent: () => persistent,
		id: name,
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
