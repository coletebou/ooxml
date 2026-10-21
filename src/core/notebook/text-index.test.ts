import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createIdGenerator } from '../collab/identity';
import { addText, moveContainers } from './canvas';
import { readPages } from './read';
import { type RichNode, readRichText, writeRichText } from './rich-text';
import { NOTEBOOK_ORIGIN, containerFragment, entityMap, notebookTypes } from './schema';
import { type NotebookEditContext, addPage, addSection, renamePage } from './structure';
import { collectTodos, createTextIndex, searchNotebook, setTodoState } from './text-index';

const context = (): NotebookEditContext => ({
	types: notebookTypes(new Y.Doc()),
	newId: createIdGenerator('a', 'nb'),
	now: () => 1,
	origin: NOTEBOOK_ORIGIN,
});
const p = (text: string, todo: 'open' | 'done' | null = null): RichNode => ({
	type: 'paragraph',
	attrs: { todo },
	content: [{ type: 'text', text }],
});

function notebook() {
	const ctx = context();
	const s = addSection(ctx, { name: 'S' });
	const one = addPage(ctx, { sectionId: s, title: 'Café plans' });
	const two = addPage(ctx, { sectionId: s, title: 'Groceries' });
	const lower = addText(ctx, one, { x: 0, y: 200, content: [p('Call the bakery', 'open')] });
	const upper = addText(ctx, one, {
		x: 0,
		y: 10,
		content: [p('Résumé review'), p('Book table', 'done')],
	});
	addText(ctx, two, { x: 0, y: 0, content: [p('Milk', 'open'), p('milk again', 'open')] });
	return { ctx, s, one, two, lower, upper, index: createTextIndex(ctx.types) };
}

describe('search and to-do tags', () => {
	it('finds titles and text, ignoring case and accents, with snippets', () => {
		const { ctx, index, one, two } = notebook();
		const pages = readPages(ctx.types);
		const hits = searchNotebook(index, pages, 'CAFE');
		expect(hits).toMatchObject([
			{ pageId: one, where: 'title', snippet: 'Café plans', start: 0, end: 4 },
		]);
		const resume = searchNotebook(index, pages, 'resume');
		expect(resume).toHaveLength(1);
		expect(resume[0]?.snippet.slice(resume[0].start, resume[0].end)).toBe('Résumé');
		// One text hit per page, in page order.
		expect(searchNotebook(index, pages, 'milk').map((h) => h.pageId)).toEqual([two]);
		expect(searchNotebook(index, pages, '   ')).toEqual([]);
		expect(searchNotebook(index, pages, 'e', 1)).toHaveLength(1);
	});

	it('updates after edits, moves and renames', () => {
		const { ctx, index, one, upper, lower } = notebook();
		const pages = () => readPages(ctx.types);
		expect(searchNotebook(index, pages(), 'bakery')).toHaveLength(1);
		const fragment = containerFragment(entityMap(ctx.types.containers, lower)!)!;
		writeRichText(fragment, [p('Call the florist', 'open')]);
		expect(searchNotebook(index, pages(), 'bakery')).toEqual([]);
		expect(searchNotebook(index, pages(), 'florist')).toHaveLength(1);
		renamePage(ctx, one, 'Dinner');
		expect(searchNotebook(index, pages(), 'dinner')[0]?.where).toBe('title');
		// Reading order: the upper container comes first; moving it below changes the to-do order.
		expect(collectTodos(index, pages()).map((t) => t.text)).toEqual([
			'Book table',
			'Call the florist',
			'Milk',
			'milk again',
		]);
		moveContainers(ctx, [upper], 0, 500);
		expect(
			collectTodos(index, pages())
				.map((t) => t.text)
				.slice(0, 2),
		).toEqual(['Call the florist', 'Book table']);
		index.destroy();
	});

	it('ticks a tag by index and text, and finds it again when tags moved', () => {
		const { ctx, index, two } = notebook();
		const [milk, again] = collectTodos(index, readPages(ctx.types)).filter((t) => t.pageId === two);
		expect(setTodoState(ctx.types, NOTEBOOK_ORIGIN, again!, 'done')).toBe(true);
		const fragment = containerFragment(entityMap(ctx.types.containers, again!.containerId)!)!;
		expect(readRichText(fragment).map((b) => b.attrs?.todo)).toEqual(['open', 'done']);
		// A collaborator inserted a tag above: index 0 now names another tag, the text still matches.
		writeRichText(fragment, [p('New first', 'open'), p('Milk', 'open'), p('milk again', 'done')]);
		expect(setTodoState(ctx.types, NOTEBOOK_ORIGIN, milk!, 'done')).toBe(true);
		expect(readRichText(fragment).map((b) => b.attrs?.todo)).toEqual(['open', 'done', 'done']);
		expect(setTodoState(ctx.types, NOTEBOOK_ORIGIN, { ...milk!, text: 'gone' }, 'done')).toBe(
			false,
		);
		expect(
			setTodoState(ctx.types, NOTEBOOK_ORIGIN, { containerId: 'nope', index: 0, text: '' }, 'done'),
		).toBe(false);
	});
});
