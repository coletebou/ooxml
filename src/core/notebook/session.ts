// One open notebook: its Y.Doc restored from storage, a collab session in the notebook's room, a
// debounced save of the whole state after every change, one undo manager for the notebook (local
// edits only, so undo never reverts a collaborator), and the text index for search and to-dos.
// Writes never wait for the room: the notebook is local-first and Yjs merges offline edits when
// the connection returns. New code.
import * as Y from 'yjs';
import { type CollabSession, createCollabSession } from '../collab/session';
import { transportProvider } from '../collab/transport-provider';
import { type NotebookStorage, notebookKey } from './storage';
import { NOTEBOOK_ORIGIN, NOTEBOOK_SEED_ORIGIN, type NotebookTypes, notebookTypes } from './schema';
import type { NotebookEditContext } from './structure';
import {
	type NotebookSyncConfig,
	type SyncClasses,
	createNotebookTransport,
	notebookRoomId,
} from './sync';
import { type TextIndex, createTextIndex } from './text-index';
import { type NotebookPresence, sanitizeNotebookPresence } from './views';

/** Origin of state restored from storage (never undoable, never re-saved on its own). */
export const NOTEBOOK_STORAGE_ORIGIN: unique symbol = Symbol('ooxml-core:notebook:storage');

export interface OpenNotebook {
	readonly id: string;
	readonly doc: Y.Doc;
	readonly types: NotebookTypes;
	readonly session: CollabSession<NotebookPresence>;
	readonly undo: Y.UndoManager;
	readonly index: TextIndex;
	/** Undoable local edits. */
	readonly edit: NotebookEditContext;
	/** Seeding and imports (not undoable). */
	readonly seed: NotebookEditContext;
	/** Save now and wait for it; rejects when the save failed (the state stays unsaved, to retry). */
	flush: () => Promise<void>;
	/** Save, leave the room and release everything. */
	close: () => Promise<void>;
}

export interface OpenNotebookOptions {
	id: string;
	storage: NotebookStorage | undefined;
	config: NotebookSyncConfig;
	classes: SyncClasses;
	user: { id: string; name: string; color?: string };
	newId: (kind: string) => string;
	now: () => number;
	saveDelayMs: number;
	/** Writes the first content of a brand-new notebook before it joins its room. */
	seed?: (ctx: NotebookEditContext) => void;
	onChange: () => void;
	/** `load` and `save` are this device's copy failing; `sync` is the room. */
	onError: (error: unknown, kind: 'load' | 'save' | 'sync') => void;
	/** A save went through (after one that failed, the changes are kept again). */
	onSaved?: () => void;
}

export async function openNotebook(options: OpenNotebookOptions): Promise<OpenNotebook> {
	const { id, storage } = options;
	const doc = new Y.Doc();
	const types = notebookTypes(doc);
	const key = notebookKey(id);
	try {
		const bytes = await storage?.load(key);
		if (bytes?.length) Y.applyUpdate(doc, bytes, NOTEBOOK_STORAGE_ORIGIN);
	} catch (error) {
		// A stored copy that cannot be read (a transient storage error, damaged bytes) is not opened:
		// an empty document would be saved over it with the first change. The caller reports it.
		doc.destroy();
		throw error;
	}
	const context = (origin: unknown): NotebookEditContext => ({
		types,
		newId: options.newId,
		now: options.now,
		origin,
	});
	const edit = context(NOTEBOOK_ORIGIN);
	const seed = context(NOTEBOOK_SEED_ORIGIN);
	try {
		options.seed?.(seed);
	} catch (error) {
		// Nothing was saved or shared yet: drop the half-written document and let the caller decide.
		doc.destroy();
		throw error;
	}

	let timer: ReturnType<typeof setTimeout> | undefined;
	let saving: Promise<void> = Promise.resolve();
	let dirty = !!options.seed;
	let closed = false;
	let failed: unknown = null;
	const save = (): Promise<void> => {
		clearTimeout(timer);
		timer = undefined;
		if (!storage || !dirty) return saving;
		dirty = false;
		const bytes = Y.encodeStateAsUpdate(doc);
		saving = saving
			.then(() => storage.save(key, bytes))
			.then(
				() => {
					failed = null;
					options.onSaved?.();
				},
				(error: unknown) => {
					// Still unsaved: the next change, flush or close tries again.
					dirty = true;
					failed = error;
					options.onError(error, 'save');
				},
			);
		return saving;
	};
	const onUpdate = (_update: Uint8Array, origin: unknown): void => {
		if (origin !== NOTEBOOK_STORAGE_ORIGIN) {
			dirty = true;
			if (!closed && timer === undefined) timer = setTimeout(save, options.saveDelayMs);
		}
		options.onChange();
	};
	doc.on('update', onUpdate);
	if (dirty) void save();

	const roomId = notebookRoomId(id);
	const session = createCollabSession<NotebookPresence>({
		roomId,
		doc,
		provider: transportProvider({
			transport: createNotebookTransport(options.config, roomId, options.classes),
		}),
		user: { name: options.user.name, ...(options.user.color ? { color: options.user.color } : {}) },
		initialPresence: { userId: options.user.id },
		sanitizePayload: sanitizeNotebookPresence,
		teardown: true,
	});
	const offStatus = session.on('status', options.onChange);
	const offPeers = session.on('peers', options.onChange);
	const offError = session.on('error', (error) => options.onError(error, 'sync'));

	const undo = new Y.UndoManager(
		[types.meta, types.sections, types.pages, types.containers, types.ink],
		{ trackedOrigins: new Set([NOTEBOOK_ORIGIN]), captureTimeout: 500, deleteFilter: keepFilled },
	);
	undo.on('stack-item-added', options.onChange);
	undo.on('stack-item-popped', options.onChange);
	const index = createTextIndex(types);

	return {
		id,
		doc,
		types,
		session,
		undo,
		index,
		edit,
		seed,
		async flush() {
			await save();
			if (failed) throw failed;
		},
		async close() {
			if (closed) return;
			closed = true;
			await save();
			offStatus();
			offPeers();
			offError();
			doc.off('update', onUpdate);
			index.destroy();
			undo.destroy();
			session.destroy();
			doc.destroy();
		},
	};
}

const PROTECTED = new Set(['paragraph', 'heading']);
/**
 * What undo may delete: not a paragraph or text that still holds something, as y-prosemirror's own
 * undo does, so undoing a new paragraph keeps the text a collaborator typed into it.
 */
export function keepFilled(item: Y.Item): boolean {
	if (!(item.content instanceof Y.ContentType)) return true;
	const type = item.content.type;
	const kept =
		type instanceof Y.XmlText || (type instanceof Y.XmlElement && PROTECTED.has(type.nodeName));
	return !kept || type.length === 0;
}
