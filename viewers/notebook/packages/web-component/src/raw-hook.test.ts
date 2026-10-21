// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNotebook, type NotebookClient, type NotebookState } from 'ooxml-ui/notebook';

// Every binding exposes the raw client from `createNotebook`, so the whole notebook API
// (notebooks, sections, pages, the canvas, search, export) reaches React `useNotebook` without
// the binding listing it.
const rawHooks = {
	react: 'react/src/index.ts',
} as const;

describe.each(Object.entries(rawHooks))('%s raw hook', (_name, file) => {
	it('hands out the core client built by createNotebook', () => {
		const source = readFileSync(resolve(process.cwd(), 'packages', file), 'utf8');
		expect(source).toContain('createNotebook(');
	});
});

/** The next state the client publishes that passes `check`. */
function next(client: NotebookClient, check: (state: NotebookState) => boolean) {
	return new Promise<NotebookState>((done) => {
		const stop = client.subscribe(() => {
			const state = client.getState();
			if (!check(state)) return;
			stop();
			done(state);
		});
	});
}

describe('the raw client', () => {
	it('works without a DOM or IndexedDB, in memory, and carries the notebook API', async () => {
		const client = createNotebook({
			user: { id: 'ada', name: 'Ada' },
			storageName: `raw-hook-${Date.now()}`,
		});
		try {
			for (const action of [
				'createNotebook',
				'openNotebook',
				'createSection',
				'selectSection',
				'createPage',
				'selectPage',
				'renamePage',
				'addText',
				'addImage',
				'addFile',
				'addStroke',
				'setTodo',
				'search',
				'undo',
				'redo',
				'exportPage',
				'exportNotebook',
				'importNotebook',
				'flush',
			] as const)
				expect(typeof client[action], action).toBe('function');
			await client.whenReady();
			const state = client.getState();
			expect(state.ready).toBe(true);
			expect(state.mode).toBe('local');
			expect(state.user).toMatchObject({ id: 'ada', name: 'Ada' });
			expect(state.notebooks).toHaveLength(1);
			expect(state.section?.name).toBe('New Section 1');
			expect(state.pages).toHaveLength(1);
		} finally {
			await client.destroy();
		}
	});

	it('names the first notebook in the requested language and publishes every change', async () => {
		const client = createNotebook({
			user: { id: 'ada', name: 'Ada' },
			storageName: `raw-hook-de-${Date.now()}`,
			locale: 'de',
		});
		try {
			await client.whenReady();
			expect(client.getState().notebook?.name).toBe('Mein Notizbuch');
			expect(client.getState().section?.name).toBe('Neuer Abschnitt 1');
			const added = next(client, (state) => state.pages.some((page) => page.title === 'Ideen'));
			const id = client.createPage({ title: 'Ideen' });
			expect((await added).pages.find((page) => page.title === 'Ideen')?.id).toBe(id);
			client.selectPage(id);
			const text = next(client, (state) => state.pageId === id && state.containers.length === 1);
			client.addText({ x: 40, y: 80 });
			expect((await text).containers[0]).toMatchObject({ kind: 'text', x: 40, y: 80 });
		} finally {
			await client.destroy();
		}
	});
});
