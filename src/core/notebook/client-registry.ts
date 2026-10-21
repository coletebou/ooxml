// The device's notebook list at run time: restored from storage, saved after each change, and
// shared with the other tabs of the same profile over BroadcastChannel (never a server). On first
// run the client waits briefly for another tab's list before it creates a default notebook, so two
// tabs opened together end up with one. Notebooks deleted more than a week ago are purged.
// New code.
import * as Y from 'yjs';
import { createBroadcastTransport, canBroadcast } from '../collab/broadcast-transport';
import type { BroadcastChannelConstructor } from '../collab/broadcast-transport';
import { type CollabSession, createCollabSession } from '../collab/session';
import { transportProvider } from '../collab/transport-provider';
import { type RegistryEntry, readRegistry, unregisterNotebook } from './registry';
import { type NotebookStorage, REGISTRY_KEY, notebookKey } from './storage';
import { registryRoomId } from './sync';

const REGISTRY_STORAGE_ORIGIN = Symbol('ooxml-core:notebook:registry-storage');
const PURGE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export interface RegistryStore {
	readonly doc: Y.Doc;
	entries: () => RegistryEntry[];
	/** True when the stored list could not be read: it is then never written over this session. */
	readFailed: () => boolean;
	start: () => Promise<void>;
	flush: () => Promise<void>;
	destroy: () => Promise<void>;
}

export interface RegistryStoreOptions {
	storage: NotebookStorage | undefined;
	scope: string;
	userName: string;
	BroadcastChannel: BroadcastChannelConstructor | undefined;
	now: () => number;
	/** How long a first run waits for another tab's list, in ms. */
	firstRunWaitMs?: number;
	onChange: () => void;
	onError: (error: unknown, kind: 'load' | 'save') => void;
	onSaved?: () => void;
}

export function createRegistryStore(options: RegistryStoreOptions): RegistryStore {
	const { storage } = options;
	const doc = new Y.Doc();
	let session: CollabSession | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let saving: Promise<void> = Promise.resolve();
	let dirty = false;
	let destroyed = false;
	let readFailed = false;

	let failed: unknown = null;
	const save = (): Promise<void> => {
		clearTimeout(timer);
		timer = undefined;
		// A list that could not be read is not replaced by this session's (it would orphan the
		// notebooks it lists); the changes stay unsaved and flush() says so.
		if (!storage || !dirty || readFailed) return saving;
		dirty = false;
		const bytes = Y.encodeStateAsUpdate(doc);
		saving = saving
			.then(() => storage.save(REGISTRY_KEY, bytes))
			.then(
				() => {
					failed = null;
					options.onSaved?.();
				},
				(error: unknown) => {
					dirty = true;
					failed = error;
					options.onError(error, 'save');
				},
			);
		return saving;
	};
	doc.on('update', (_u: Uint8Array, origin: unknown) => {
		if (origin !== REGISTRY_STORAGE_ORIGIN) {
			dirty = true;
			if (!destroyed && timer === undefined) timer = setTimeout(save, 150);
		}
		options.onChange();
	});

	const purge = async (): Promise<void> => {
		const cutoff = options.now() - PURGE_AFTER_MS;
		for (const entry of readRegistry(doc)) {
			if (!entry.deleted || entry.deleted > cutoff) continue;
			unregisterNotebook(doc, entry.id);
			await storage?.remove(notebookKey(entry.id)).catch((error) => options.onError(error, 'save'));
		}
	};

	const BC = options.BroadcastChannel;
	const shared = !!BC || canBroadcast();
	return {
		doc,
		entries: () => readRegistry(doc),
		readFailed: () => readFailed,
		async start() {
			try {
				const bytes = await storage?.load(REGISTRY_KEY);
				if (bytes?.length) Y.applyUpdate(doc, bytes, REGISTRY_STORAGE_ORIGIN);
			} catch (error) {
				readFailed = true;
				failed = error;
				options.onError(error, 'load');
			}
			if (destroyed) return;
			if (!readFailed) await purge();
			if (!shared) return;
			const roomId = registryRoomId(options.scope);
			session = createCollabSession({
				roomId,
				doc,
				provider: transportProvider({
					transport: createBroadcastTransport({ roomId, ...(BC ? { BroadcastChannel: BC } : {}) }),
				}),
				user: { name: options.userName },
				syncGraceMs: options.firstRunWaitMs ?? 400,
				heartbeatMs: 0,
			});
			// A first run waits for another tab's list (or the grace period) before deciding.
			if (!readRegistry(doc).length && !session.canWrite())
				await new Promise<void>((resolve) => {
					const off = session!.on('ready', () => (off(), resolve()));
				});
		},
		async flush() {
			await save();
			if (failed) throw failed;
		},
		async destroy() {
			if (destroyed) return;
			destroyed = true;
			await save();
			session?.destroy();
			doc.destroy();
		},
	};
}
