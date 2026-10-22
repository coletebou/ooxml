// One open notebook: its Y.Doc restored from storage, a collab session in the notebook's room, a
// debounced save of what changed (see `journal.ts`), one undo manager for the notebook (local
// edits only, so undo never reverts a collaborator), and the text index for search and to-dos.
// Writes never wait for the room: the notebook is local-first and Yjs merges offline edits when
// the connection returns. New code.
import * as Y from 'yjs';
import { type CollabSession, createCollabSession } from '../collab/session';
import { transportProvider } from '../collab/transport-provider';
import { notebookCopy } from './journal';
import { type NotebookStorage, notebookKey, tabCopies as rescued } from './storage';
import {
	NOTEBOOK_ORIGIN,
	NOTEBOOK_SEED_ORIGIN,
	type NotebookTypes,
	notebookTypes,
	NOTEBOOK_MAPS,
} from './schema';
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
	const copy = storage && notebookCopy(storage, id);
	try {
		await copy?.load(doc, NOTEBOOK_STORAGE_ORIGIN);
		// What a closed copy of this notebook could not save in this tab comes back, to save again.
		const kept = storage && rescued(storage).get(key);
		if (kept) Y.applyUpdate(doc, kept);
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
	// The updates not saved yet; a new notebook's first content and a copy this tab kept were
	// written before anything listened, so they start as the whole state.
	let pending: Uint8Array[] =
		options.seed || (storage && rescued(storage).has(key)) ? [Y.encodeStateAsUpdate(doc)] : [];
	let closed = false;
	let failed: unknown = null;
	const save = (): Promise<void> => {
		clearTimeout(timer);
		timer = undefined;
		if (!copy) return saving;
		// The changes are taken when this save runs, after the ones before it: a save that failed
		// put its changes back, so they go with this one, and a success means nothing is left.
		saving = saving.then(async () => {
			if (!pending.length) return;
			const changes = pending.length === 1 ? pending[0]! : Y.mergeUpdates(pending);
			pending = [];
			try {
				await copy.save(doc, changes);
			} catch (error) {
				// Still unsaved: the next change, flush or close tries again.
				pending.unshift(changes);
				failed = error;
				options.onError(error, 'save');
				return;
			}
			failed = null;
			if (storage) rescued(storage).delete(key);
			options.onSaved?.();
		});
		return saving;
	};
	const onUpdate = (update: Uint8Array, origin: unknown): void => {
		// Local edits and collaborators' (this device may not have those yet); never what was read.
		if (origin !== NOTEBOOK_STORAGE_ORIGIN) {
			if (copy) pending.push(update);
			if (!closed && timer === undefined) timer = setTimeout(save, options.saveDelayMs);
		}
		options.onChange();
	};
	doc.on('update', onUpdate);
	if (pending.length) void save();

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

	const keeper = undoKeeper();
	const undo = new Y.UndoManager(
		[types.meta, types.sections, types.pages, types.containers, types.ink],
		{
			trackedOrigins: new Set([NOTEBOOK_ORIGIN]),
			captureTimeout: 500,
			deleteFilter: keeper.filter,
		},
	);
	undo.on('stack-item-added', options.onChange);
	undo.on('stack-item-popped', options.onChange);
	keeper.attach(undo);
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
			// The device refused the last save: the tab keeps a copy for the next open of it.
			if ((failed || pending.length) && storage)
				rescued(storage).set(key, Y.encodeStateAsUpdate(doc));
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

const PROTECTED = new Set(['paragraph', 'heading', 'list_item', 'bullet_list', 'ordered_list']);
/**
 * What undo may delete: not a paragraph or text that still holds something, as y-prosemirror's own
 * undo does, so undoing a new paragraph keeps the text a collaborator typed into it.
 */
/**
 * What undo may delete. A box, page or section that is kept (it holds what a collaborator added)
 * keeps the fields that were set with it, in the step being undone; fields set later (a move, a
 * delete flag) undo as usual. `attach` lets it see that step.
 */
export function undoKeeper(): {
	filter: (item: Y.Item) => boolean;
	attach: (manager: Y.UndoManager) => void;
} {
	let step: { insertions: Parameters<typeof Y.isDeleted>[0] } | null = null;
	const filter = (item: Y.Item): boolean => {
		const parent = item.parent;
		const created = parent instanceof Y.Map ? parent._item : null;
		if (
			created &&
			item.parentSub !== null &&
			step &&
			Y.isDeleted(step.insertions, created.id) &&
			kept(parent as Y.Map<unknown>)
		)
			return false;
		if (!(item.content instanceof Y.ContentType)) return true;
		const type = item.content.type;
		if (type instanceof Y.Map) return !kept(type);
		if (type instanceof Y.XmlFragment && !(type instanceof Y.XmlElement)) return !hasText(type);
		if (type instanceof Y.XmlText) return type.length === 0;
		if (type instanceof Y.XmlElement && PROTECTED.has(type.nodeName)) return !hasText(type);
		return true;
	};
	const attach = (manager: Y.UndoManager): void => {
		for (const [name, stack] of [
			['undo', () => manager.undoStack],
			['redo', () => manager.redoStack],
		] as const) {
			const run = manager[name].bind(manager);
			manager[name] = () => {
				step = stack().at(-1) ?? null;
				try {
					return run();
				} finally {
					step = null;
				}
			};
		}
	};
	return { filter, attach };
}

/** A text box holding text, a page with boxes or ink on it, a section with pages: undo keeps it. */
function kept(map: Y.Map<unknown>): boolean {
	const content = map.get('content');
	if (content instanceof Y.XmlFragment) return hasText(content);
	const doc = map.doc;
	const key = map._item?.parentSub;
	if (!doc || !key) return false;
	const owner = map._item?.parent;
	const uses = (name: string, field: string): boolean => {
		for (const value of doc.getMap(name).values()) {
			const at =
				value instanceof Y.Map
					? value.get(field)
					: (value as Record<string, unknown> | null)?.[field];
			if (at === key) return true;
		}
		return false;
	};
	if (owner === doc.getMap(NOTEBOOK_MAPS.pages))
		return uses(NOTEBOOK_MAPS.containers, 'page') || uses(NOTEBOOK_MAPS.ink, 'page');
	if (owner === doc.getMap(NOTEBOOK_MAPS.sections)) return uses(NOTEBOOK_MAPS.pages, 'section');
	return false;
}

function hasText(fragment: Y.XmlFragment | Y.XmlElement): boolean {
	const stack: unknown[] = fragment.toArray();
	while (stack.length) {
		const item = stack.pop();
		if (item instanceof Y.XmlText && item.length) return true;
		if (item instanceof Y.XmlElement) stack.push(...item.toArray());
	}
	return false;
}
