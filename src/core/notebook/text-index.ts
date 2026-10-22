// Search across a notebook (page titles and container text) and the to-do summary (checkbox tags).
// The re-validated text of each container is cached and invalidated by a deep observer, so a search
// or a summary after a keystroke re-reads only the container that changed. Matching ignores case
// and diacritics; snippets are cut from the original text. New code.
import * as Y from 'yjs';
import type { PageEntry } from './model';
import { MAX_ELEMENT_DEPTH } from './model';
import { type TextBlock, type TodoState, readRichText, textBlocks } from './rich-text';
import { type NotebookTypes, containerFragment, entityMap } from './schema';

export interface SearchHit {
	pageId: string;
	sectionId: string;
	pageTitle: string;
	where: 'title' | 'text';
	containerId?: string;
	/** Text around the match, and the match's offsets inside it. */
	snippet: string;
	start: number;
	end: number;
}

export interface TodoItem {
	pageId: string;
	sectionId: string;
	pageTitle: string;
	containerId: string;
	/** Position among the container's to-do tags (with `text`, identifies the tag). */
	index: number;
	text: string;
	done: boolean;
}

export interface TextIndex {
	/** Paragraphs and headings of a text container (cached). */
	blocks: (containerId: string) => TextBlock[];
	/** Text containers of each page, in reading order of `y` then `x`. */
	textContainers: () => Map<string, string[]>;
	destroy: () => void;
}

export function createTextIndex(types: NotebookTypes): TextIndex {
	const cache = new Map<string, TextBlock[]>();
	let byPage: Map<string, string[]> | null = null;
	const observer = (events: Y.YEvent<Y.AbstractType<unknown>>[]): void => {
		for (const event of events) {
			if (event.target === types.containers) {
				for (const key of event.changes.keys.keys()) cache.delete(key);
				byPage = null;
				continue;
			}
			const id = event.path[0];
			if (typeof id === 'string') cache.delete(id);
			// A move changes the reading order, not the text.
			if (event.path.length === 1) byPage = null;
		}
	};
	types.containers.observeDeep(observer);
	return {
		blocks(id) {
			let blocks = cache.get(id);
			if (!blocks) {
				const map = entityMap(types.containers, id);
				const fragment = map && containerFragment(map);
				blocks = fragment ? textBlocks(readRichText(fragment)) : [];
				cache.set(id, blocks);
			}
			return blocks;
		},
		textContainers() {
			if (byPage) return byPage;
			const rows: { id: string; page: string; x: number; y: number }[] = [];
			types.containers.forEach((value, id) => {
				if (!(value instanceof Y.Map) || value.get('kind') !== 'text') return;
				const page = value.get('page');
				if (typeof page !== 'string') return;
				rows.push({ id, page, x: Number(value.get('x')) || 0, y: Number(value.get('y')) || 0 });
			});
			rows.sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1));
			byPage = new Map();
			for (const row of rows) byPage.set(row.page, [...(byPage.get(row.page) ?? []), row.id]);
			return byPage;
		},
		destroy() {
			types.containers.unobserveDeep(observer);
			cache.clear();
		},
	};
}

/** Text folded for matching, with the index in the original string of every folded character. */
function fold(text: string): { folded: string; at: number[] } {
	let folded = '';
	const at: number[] = [];
	let i = 0;
	for (const char of text) {
		const f = char.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
		for (let k = 0; k < f.length; k++) at.push(i);
		folded += f;
		i += char.length;
	}
	at.push(i);
	return { folded, at };
}

const foldQuery = (query: string): string => fold(query.trim()).folded;

function snippetOf(
	text: string,
	query: string,
	radius = 40,
): Omit<SearchHit, 'pageId' | 'sectionId' | 'pageTitle' | 'where'> | null {
	const { folded, at } = fold(text);
	const found = folded.indexOf(query);
	if (found < 0) return null;
	const start = at[found] ?? 0;
	const end = at[found + query.length] ?? text.length;
	const from = Math.max(0, start - radius);
	const to = Math.min(text.length, end + radius);
	const prefix = from > 0 ? '...' : '';
	const snippet =
		prefix + text.slice(from, to).replace(/\s+/gu, ' ') + (to < text.length ? '...' : '');
	// Whitespace collapsing can shift the offsets; recompute them in the snippet itself.
	const local = fold(snippet);
	const s = local.folded.indexOf(query);
	return s < 0
		? { snippet, start: 0, end: 0 }
		: { snippet, start: local.at[s] ?? 0, end: local.at[s + query.length] ?? snippet.length };
}

/** Pages whose title or text contains `query`, in the order of `pages`; at most `limit` hits. */
export function searchNotebook(
	index: TextIndex,
	pages: readonly PageEntry[],
	query: string,
	limit = 200,
): SearchHit[] {
	const q = foldQuery(query);
	if (!q) return [];
	const containers = index.textContainers();
	const hits: SearchHit[] = [];
	for (const page of pages) {
		if (hits.length >= limit) break;
		const base = { pageId: page.id, sectionId: page.sectionId, pageTitle: page.title };
		const title = snippetOf(page.title, q, 80);
		if (title) hits.push({ ...base, where: 'title', ...title });
		for (const id of containers.get(page.id) ?? []) {
			const text = index
				.blocks(id)
				.map((b) => b.text)
				.join('\n');
			const hit = snippetOf(text, q);
			if (hit) {
				hits.push({ ...base, where: 'text', containerId: id, ...hit });
				break;
			}
		}
	}
	return hits.slice(0, limit);
}

/** Every to-do tag on `pages` (in page order, then reading order). */
export function collectTodos(index: TextIndex, pages: readonly PageEntry[]): TodoItem[] {
	const containers = index.textContainers();
	const out: TodoItem[] = [];
	for (const page of pages) {
		for (const id of containers.get(page.id) ?? []) {
			let n = 0;
			for (const block of index.blocks(id)) {
				if (!block.todo) continue;
				out.push({
					pageId: page.id,
					sectionId: page.sectionId,
					pageTitle: page.title,
					containerId: id,
					index: n++,
					text: block.text,
					done: block.todo === 'done',
				});
			}
		}
	}
	return out;
}

function elementText(element: Y.XmlElement): string {
	let out = '';
	for (const child of element.toArray()) {
		if (child instanceof Y.XmlText)
			for (const op of child.toDelta() as { insert?: unknown }[])
				out += typeof op.insert === 'string' ? op.insert : '';
		else if (child instanceof Y.XmlElement && child.nodeName === 'hard_break') out += '\n';
	}
	return out;
}

function todoElements(fragment: Y.XmlFragment): Y.XmlElement[] {
	const out: Y.XmlElement[] = [];
	const walk = (items: readonly unknown[], depth: number): void => {
		for (const item of items) {
			if (!(item instanceof Y.XmlElement) || depth > MAX_ELEMENT_DEPTH) continue;
			const todo = item.getAttribute('todo');
			if (
				(item.nodeName === 'paragraph' || item.nodeName === 'heading') &&
				(todo === 'open' || todo === 'done')
			)
				out.push(item);
			else walk(item.toArray(), depth + 1);
		}
	};
	walk(fragment.toArray(), 0);
	return out;
}

/**
 * Tick or untick a to-do tag. `index` and `text` come from the summary; when a collaborator moved
 * tags in the meantime, the first tag with the same text is used instead.
 */
export function setTodoState(
	types: NotebookTypes,
	origin: unknown,
	tag: { containerId: string; index: number; text: string },
	state: TodoState,
): boolean {
	const map = entityMap(types.containers, tag.containerId);
	const fragment = map && containerFragment(map);
	if (!fragment) return false;
	const tags = todoElements(fragment);
	const target =
		tags[tag.index] && elementText(tags[tag.index]!) === tag.text
			? tags[tag.index]
			: tags.find((t) => elementText(t) === tag.text);
	if (!target) return false;
	if (target.getAttribute('todo') !== state)
		types.doc.transact(() => target.setAttribute('todo', state), origin);
	return true;
}
