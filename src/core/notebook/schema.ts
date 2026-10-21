// The shared notebook document. One Y.Doc per notebook (it is also the sync room) with top-level
// maps only, because top-level types never conflict when two peers initialise a room at once:
//
// - `notebook:meta`: schema version, name, colour, created.
// - `notebook:sections`: id to Y.Map (kind, name, colour, parent, order, created, deleted, trash).
// - `notebook:pages`: id to Y.Map (section, title, created, order, level, deleted, trash).
// - `notebook:containers`: id to Y.Map (page, kind, x, y, w, h, z, picture and file fields; a text
//   container's `content` is a Y.XmlFragment in the y-prosemirror encoding, see `rich-text.ts`).
// - `notebook:ink`: stroke id to a plain JSON stroke (strokes never change once drawn).
// - `notebook:assets`: binary payloads of pictures and files, through collab `createAssetSync`.
//
// Entity ids are minted per client (`createIdGenerator`), so concurrent adds never collide and each
// entity's map is created by exactly one peer. New code.
import * as Y from 'yjs';
import { createAssetSync } from '../collab/assets';

/** Origin of every local edit; the notebook's undo manager tracks only this (and the editor's). */
export const NOTEBOOK_ORIGIN: unique symbol = Symbol('ooxml-core:notebook:edit');
/** Origin of seeding and imports, which are not undoable. */
export const NOTEBOOK_SEED_ORIGIN: unique symbol = Symbol('ooxml-core:notebook:seed');

export const NOTEBOOK_MAPS = {
	meta: 'notebook:meta',
	sections: 'notebook:sections',
	pages: 'notebook:pages',
	containers: 'notebook:containers',
	ink: 'notebook:ink',
	assets: 'notebook:assets',
} as const;

export interface NotebookTypes {
	readonly doc: Y.Doc;
	readonly meta: Y.Map<unknown>;
	readonly sections: Y.Map<unknown>;
	readonly pages: Y.Map<unknown>;
	readonly containers: Y.Map<unknown>;
	readonly ink: Y.Map<unknown>;
	readonly assets: Y.Map<unknown>;
}

const cache = new WeakMap<Y.Doc, NotebookTypes>();

/** The notebook's shared types in `doc` (created on first access, as Yjs does). */
export function notebookTypes(doc: Y.Doc): NotebookTypes {
	let types = cache.get(doc);
	if (!types) {
		types = {
			doc,
			meta: doc.getMap(NOTEBOOK_MAPS.meta),
			sections: doc.getMap(NOTEBOOK_MAPS.sections),
			pages: doc.getMap(NOTEBOOK_MAPS.pages),
			containers: doc.getMap(NOTEBOOK_MAPS.containers),
			ink: doc.getMap(NOTEBOOK_MAPS.ink),
			assets: doc.getMap(NOTEBOOK_MAPS.assets),
		};
		cache.set(doc, types);
	}
	return types;
}

/** Picture and file bytes live in `notebook:assets`; the container keeps a `_dataRef` pointer. */
export const NOTEBOOK_ASSETS = createAssetSync({
	mapName: NOTEBOOK_MAPS.assets,
	fields: { data: '_dataRef' },
});

/** The entity map stored under `id`, if it really is one (a peer may have written anything). */
export function entityMap(map: Y.Map<unknown>, id: string): Y.Map<unknown> | undefined {
	const value = map.get(id);
	return value instanceof Y.Map ? value : undefined;
}

/** Every `[id, map]` of a map of entity maps, skipping values that are not maps. */
export function entityMaps(map: Y.Map<unknown>): [string, Y.Map<unknown>][] {
	const out: [string, Y.Map<unknown>][] = [];
	map.forEach((value, key) => {
		if (value instanceof Y.Map) out.push([key, value]);
	});
	return out;
}

/** The text of a text container, if its `content` really is a fragment. */
export function containerFragment(map: Y.Map<unknown>): Y.XmlFragment | undefined {
	const value = map.get('content');
	return value instanceof Y.XmlFragment ? value : undefined;
}

/** True while nothing has been written to the notebook yet (a room still waiting for its state). */
export function isEmptyNotebook(doc: Y.Doc): boolean {
	const types = notebookTypes(doc);
	return types.meta.size === 0 && types.sections.size === 0 && types.pages.size === 0;
}
