// A notebook's copy on the device. On a storage that reads key ranges (`loadPrefix`) it is a log:
// bases (whole states) and entries (what one save changed), each under a key of its own. A save
// writes only what changed (a keystroke, not the pictures and files in the notebook), and clients
// on one storage that cannot reach each other never write over each other's saves. A compaction
// stores one base made from the live document, which leaves deleted content out (merging stored
// updates would keep it), and then removes only the keys this client read or wrote, so a newer
// save of another client always stays and no lock is needed. On a storage without `loadPrefix` the
// notebook is one copy, merged with what is stored on every save. New code.
import * as Y from 'yjs';
import { type NotebookStorage, mergeIntoStorage, notebookKey } from './storage';

/** Entries a log may gather before it is compacted. */
const COMPACT_ENTRIES = 500;
/** Bytes of entries that never trigger a compaction, whatever the base's size. */
const COMPACT_MIN_BYTES = 64 * 1024;

export interface NotebookCopy {
	/** Read everything stored into `doc` under `origin`; rejects when any of it cannot be read. */
	load: (doc: Y.Doc, origin: unknown) => Promise<void>;
	/** Store `changes`, the Yjs updates since the last save (`doc` holds them too). */
	save: (doc: Y.Doc, changes: Uint8Array) => Promise<void>;
}

function token(): string {
	let hex = '';
	for (const byte of crypto.getRandomValues(new Uint8Array(12)))
		hex += byte.toString(16).padStart(2, '0');
	return hex;
}

const logPrefix = (id: string): string => `${notebookKey(id)}:`;

export function notebookCopy(storage: NotebookStorage, id: string): NotebookCopy {
	const key = notebookKey(id);
	const { loadPrefix } = storage;
	if (!loadPrefix)
		return {
			async load(doc, origin) {
				const bytes = await storage.load(key);
				if (bytes?.length) Y.applyUpdate(doc, bytes, origin);
			},
			save: (doc) => mergeIntoStorage(storage, key, Y.encodeStateAsUpdate(doc)),
		};
	const prefix = logPrefix(id);
	// What this client read or wrote: all of it is in its document, so a compaction may remove it.
	const known = new Set<string>();
	let baseBytes = 0;
	let entryBytes = 0;
	let entries = 0;
	const compact = async (doc: Y.Doc): Promise<void> => {
		const base = Y.encodeStateAsUpdate(doc);
		const fresh = `${prefix}b:${token()}`;
		await storage.save(fresh, base);
		const folded = [...known];
		known.clear();
		known.add(fresh);
		baseBytes = base.length;
		entryBytes = 0;
		entries = 0;
		// Only once the new base is stored. A removal that fails leaves a duplicate, never a loss.
		await Promise.all(folded.map((k) => storage.remove(k).catch(() => undefined)));
	};
	return {
		async load(doc, origin) {
			// The one copy an older version kept is read first: a client that compacts meanwhile stores
			// its base before it removes that copy, so the range read after it then finds the base.
			const single = await storage.load(key);
			const stored = await loadPrefix(prefix);
			if (single?.length) {
				Y.applyUpdate(doc, single, origin);
				known.add(key);
				baseBytes += single.length;
			}
			for (const [k, bytes] of stored) {
				if (!k.startsWith(prefix)) continue;
				Y.applyUpdate(doc, bytes, origin);
				known.add(k);
				if (k.startsWith(`${prefix}b:`)) baseBytes += bytes.length;
				else {
					entries++;
					entryBytes += bytes.length;
				}
			}
			// Several pieces (other clients' saves) or an older version's copy become one base now;
			// when that fails they stay as they are and the next compaction folds them.
			if (known.size > 1 || known.has(key)) await compact(doc).catch(() => undefined);
		},
		async save(doc, changes) {
			const k = `${prefix}u:${token()}`;
			await storage.save(k, changes);
			known.add(k);
			entries++;
			entryBytes += changes.length;
			// The changes are stored; a compaction that fails is tried again by a later save.
			if (entries >= COMPACT_ENTRIES || entryBytes >= Math.max(baseBytes, COMPACT_MIN_BYTES))
				await compact(doc).catch(() => undefined);
		},
	};
}

/** Remove everything stored for notebook `id`. */
export async function removeNotebookCopy(storage: NotebookStorage, id: string): Promise<void> {
	await storage.remove(notebookKey(id));
	const stored = (await storage.loadPrefix?.(logPrefix(id))) ?? [];
	await Promise.all(stored.map(([k]) => storage.remove(k)));
}
