// The notebooks on this device: a small Y.Doc (`notebooks:list`, id to Y.Map of name, colour,
// order, created, deleted, last section and page) kept in local storage and shared between the
// tabs of one profile, so creating, renaming or reordering a notebook in one tab shows in the
// others and concurrent changes merge. It never goes to a server: a notebook's name and colour
// are also in the notebook's own document, which is what collaborators see. New code.
import * as Y from 'yjs';
import { reorderFractional } from '../collab/ordering';
import {
	type NotebookEntry,
	byOrder,
	isEntityId,
	isFiniteNumber,
	sanitizeHexColor,
	sanitizeName,
	sanitizeTimestamp,
} from './model';
import { paletteColor } from './palette';
import { entityMap, entityMaps } from './schema';

export const REGISTRY_MAP = 'notebooks:list';

export interface RegistryEntry extends NotebookEntry {
	lastSection: string;
	lastPage: string;
	/** Renamed or recoloured while closed: the notebook's own document takes these on next open. */
	pending: boolean;
}

const list = (doc: Y.Doc): Y.Map<unknown> => doc.getMap(REGISTRY_MAP);

/** Every notebook on the device, including deleted ones, in order. */
export function readRegistry(doc: Y.Doc): RegistryEntry[] {
	return entityMaps(list(doc))
		.filter(([id]) => isEntityId(id))
		.map(([id, map], index): RegistryEntry => {
			const deleted = sanitizeTimestamp(map.get('deleted'));
			const lastSection = map.get('lastSection');
			const lastPage = map.get('lastPage');
			return {
				id,
				name: sanitizeName(map.get('name'), 'Notebook'),
				color: sanitizeHexColor(map.get('color'), paletteColor(index)),
				order: isFiniteNumber(map.get('order')) ? (map.get('order') as number) : 0,
				created: sanitizeTimestamp(map.get('created')),
				lastSection: isEntityId(lastSection) ? lastSection : '',
				lastPage: isEntityId(lastPage) ? lastPage : '',
				pending: map.get('pending') === true,
				...(deleted ? { deleted } : {}),
			};
		})
		.sort(byOrder);
}

/** Add a notebook to the device's list (last); returns false when the id is taken or invalid. */
export function registerNotebook(
	doc: Y.Doc,
	entry: { id: string; name: string; color: string; created: number },
	origin?: unknown,
): boolean {
	if (!isEntityId(entry.id) || list(doc).has(entry.id)) return false;
	const last = readRegistry(doc).at(-1)?.order ?? 0;
	doc.transact(() => {
		const map = new Y.Map<unknown>();
		list(doc).set(entry.id, map);
		map.set('name', sanitizeName(entry.name, 'Notebook'));
		map.set('color', sanitizeHexColor(entry.color, paletteColor(0)));
		map.set('order', last + 1);
		map.set('created', entry.created);
	}, origin);
	return true;
}

/** Change a notebook's cached name, colour, last position or deleted mark. */
export function updateRegistry(
	doc: Y.Doc,
	id: string,
	patch: Partial<Pick<RegistryEntry, 'name' | 'color' | 'lastSection' | 'lastPage' | 'pending'>> & {
		deleted?: number | null;
	},
	origin?: unknown,
): boolean {
	const map = entityMap(list(doc), id);
	if (!map) return false;
	doc.transact(() => {
		if (patch.name !== undefined) map.set('name', sanitizeName(patch.name, 'Notebook'));
		if (patch.color !== undefined) map.set('color', sanitizeHexColor(patch.color, paletteColor(0)));
		if (patch.lastSection !== undefined && map.get('lastSection') !== patch.lastSection)
			map.set('lastSection', patch.lastSection);
		if (patch.lastPage !== undefined && map.get('lastPage') !== patch.lastPage)
			map.set('lastPage', patch.lastPage);
		if (patch.pending === false) map.delete('pending');
		else if (patch.pending) map.set('pending', true);
		if (patch.deleted === null) map.delete('deleted');
		else if (patch.deleted !== undefined) map.set('deleted', patch.deleted);
	}, origin);
	return true;
}

/** Move a notebook before `beforeId` (or last) among the notebooks that are not deleted. */
export function moveInRegistry(
	doc: Y.Doc,
	id: string,
	beforeId?: string,
	origin?: unknown,
): boolean {
	const entries = readRegistry(doc).filter((e) => !e.deleted);
	const moving = entries.find((e) => e.id === id);
	if (!moving) return false;
	const rest = entries.filter((e) => e.id !== id);
	let at = beforeId ? rest.findIndex((e) => e.id === beforeId) : -1;
	if (at < 0) at = rest.length;
	const sequence = [...rest.slice(0, at), moving, ...rest.slice(at)];
	const changes = reorderFractional(sequence.map((e) => (e.id === id ? undefined : e.order)));
	doc.transact(() => {
		for (const [index, order] of changes) {
			const entry = sequence[index];
			if (entry) entityMap(list(doc), entry.id)?.set('order', order);
		}
	}, origin);
	return true;
}

/** Forget a notebook on this device (its stored document is removed by the caller). */
export function unregisterNotebook(doc: Y.Doc, id: string, origin?: unknown): void {
	doc.transact(() => list(doc).delete(id), origin);
}
