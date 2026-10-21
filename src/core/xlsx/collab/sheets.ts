// Sheet identity and order in a shared workbook. Sheets are keyed by an id minted by the peer
// that added them, so concurrent adds never collide and a rename or move keeps the key. Order is
// a fractional `order` per sheet (concurrent moves of different sheets both apply); names and
// `sheetId`s that collide after concurrent adds are made unique deterministically on read.
import type * as Y from 'yjs';
import type { Color, SheetState, Worksheet } from '../model';
import { childMap, isRecord } from './schema';

/** Fractional order values for a move; shared with every product in `collab/ordering`. */
export { reorderFractional as reorder } from '../../collab/ordering';

export interface SheetEntry {
	key: string;
	map: Y.Map<unknown>;
	/** Effective (de-duplicated) name and sheetId. */
	name: string;
	sheetId: number;
	order: number;
	state: SheetState;
	tabColor?: Color;
	defaultRowHeight?: number;
	defaultColWidth?: number;
}

const STATES: readonly SheetState[] = ['visible', 'hidden', 'veryHidden'];
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Valid sheets in display order, with names and sheetIds made unique. */
export function sheetEntries(sheets: Y.Map<unknown>): SheetEntry[] {
	const out: SheetEntry[] = [];
	for (const key of [...sheets.keys()].sort()) {
		const map = childMap(sheets, key);
		const props = map && childMap(map, 'props');
		const name = props?.get('name');
		if (!map || !props || typeof name !== 'string' || !name || name.length > 31) continue;
		const sheetId = props.get('sheetId');
		const order = props.get('order');
		const state = props.get('state');
		const entry: SheetEntry = {
			key,
			map,
			name,
			sheetId: isNumber(sheetId) && sheetId > 0 ? Math.floor(sheetId) : 0,
			order: isNumber(order) ? order : 0,
			state: STATES.includes(state as SheetState) ? (state as SheetState) : 'visible',
		};
		const tab = props.get('tab');
		if (isRecord(tab)) entry.tabColor = structuredClone(tab) as Color;
		const rh = props.get('rh');
		if (isNumber(rh) && rh > 0) entry.defaultRowHeight = rh;
		const cw = props.get('cw');
		if (isNumber(cw) && cw > 0) entry.defaultColWidth = cw;
		out.push(entry);
	}
	// Collisions are resolved in key order so a later move or rename never flips who wins.
	const ids = new Set<number>();
	const names = new Set<string>();
	let maxId = out.reduce((max, e) => Math.max(max, e.sheetId), 0);
	for (const entry of out) {
		if (!entry.sheetId || ids.has(entry.sheetId)) entry.sheetId = ++maxId;
		ids.add(entry.sheetId);
		if (names.has(entry.name.toLowerCase())) {
			const base = entry.name.slice(0, 26);
			let n = 2;
			while (names.has(`${base} (${n})`.toLowerCase())) n++;
			entry.name = `${base} (${n})`;
		}
		names.add(entry.name.toLowerCase());
	}
	return out.sort((a, b) => a.order - b.order || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Remembers which shared key each local sheet object has. */
export class SheetKeys {
	private readonly byObject = new WeakMap<Worksheet, string>();
	private counter = 0;

	constructor(private readonly clientId: number) {}

	remember(sheet: Worksheet, key: string): void {
		this.byObject.set(sheet, key);
	}

	/** The key of a known sheet object, else of the shared sheet with its sheetId. */
	find(sheet: Worksheet, entries: readonly SheetEntry[]): string | undefined {
		const known = this.byObject.get(sheet);
		if (known !== undefined) return known;
		const match = entries.find((entry) => entry.sheetId === sheet.sheetId)?.key;
		if (match !== undefined) this.byObject.set(sheet, match);
		return match;
	}

	/** The sheet's key, minting a new one for a sheet the room does not know. */
	resolve(sheet: Worksheet, entries: readonly SheetEntry[], taken: Y.Map<unknown>): string {
		const found = this.find(sheet, entries);
		if (found !== undefined && taken.has(found)) return found;
		let key: string;
		do key = `${this.clientId.toString(36)}-${(this.counter++).toString(36)}`;
		while (taken.has(key));
		this.byObject.set(sheet, key);
		return key;
	}
}
