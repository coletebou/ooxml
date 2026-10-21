import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDocx } from '../docx/parse';
import { createNotebookClient } from './client';
import type { NotebookClient, NotebookClientOptions } from './client-types';
import { type NotebookStorage, createMemoryStorage } from './storage';
import { createChannelHub, settle } from './test-support/channel';

const clients: NotebookClient[] = [];
afterEach(async () => {
	await Promise.all(clients.splice(0).map((c) => c.destroy()));
});

function start(
	storage: NotebookStorage,
	hub: ReturnType<typeof createChannelHub>,
	extra: Partial<NotebookClientOptions> = {},
) {
	const client = createNotebookClient({
		user: { name: 'Ada' },
		storage,
		BroadcastChannel: hub,
		saveDelayMs: 5,
		names: { notebook: 'Notebook', section: 'Section' },
		...extra,
	});
	clients.push(client);
	return client;
}

async function until(check: () => boolean, ms = 3000): Promise<void> {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw new Error('timed out');
		await settle(5);
	}
}

const para = (text: string, todo: 'open' | 'done' | null = null) => ({
	type: 'paragraph',
	attrs: { todo },
	content: [{ type: 'text', text }],
});

describe('notebook client', () => {
	it('creates a first notebook with a section and a page, then edits and undoes structure', async () => {
		const client = start(createMemoryStorage(), createChannelHub());
		await client.whenReady();
		await settle();
		let state = client.getState();
		expect(state.ready).toBe(true);
		expect(state.notebooks.map((n) => n.name)).toEqual(['Notebook']);
		expect(state.sections.map((s) => s.name)).toEqual(['Section 1']);
		expect(state.pages).toHaveLength(1);
		expect(state.pageId).toBe(state.pages[0]?.id);

		const section = client.createSection();
		const page = client.createPage({ title: 'Plan' });
		const sub = client.createPage({ subpage: true, title: 'Detail' });
		await settle();
		state = client.getState();
		expect(state.sectionId).toBe(section);
		expect(state.pages.map((p) => [p.title, p.level])).toEqual([
			['', 0],
			['Plan', 0],
			['Detail', 1],
		]);
		expect(state.pageId).toBe(sub);
		expect(state.canUndo).toBe(true);

		client.undo();
		await settle();
		expect(client.getState().pages.map((p) => p.title)).toEqual(['', 'Plan']);
		expect(client.getState().pageId).not.toBe(sub);
		client.redo();
		await settle();
		expect(client.getState().pages.map((p) => p.title)).toEqual(['', 'Plan', 'Detail']);

		const batch = client.deletePage(page)!;
		await settle();
		expect(client.getState().pages.map((p) => p.title)).toEqual(['']);
		client.restore(batch);
		await settle();
		expect(client.getState().pages.map((p) => p.title)).toEqual(['', 'Plan', 'Detail']);
	});

	it('keeps everything on the device across a reload', async () => {
		const storage = createMemoryStorage();
		const first = start(storage, createChannelHub());
		await first.whenReady();
		client_addContent(first);
		await settle();
		const before = first.getState();
		await first.destroy();

		const second = start(storage, createChannelHub());
		await second.whenReady();
		await settle();
		const after = second.getState();
		expect(after.notebookId).toBe(before.notebookId);
		expect(after.sectionId).toBe(before.sectionId);
		expect(after.pageId).toBe(before.pageId);
		expect(after.containers.map((c) => c.kind)).toEqual(['text', 'image']);
		expect(after.strokes).toHaveLength(1);
		expect(after.todos.map((t) => [t.text, t.done])).toEqual([['Call Bob', false]]);
		expect(second.containerBytes(after.containers[1]!.id)).toEqual(new Uint8Array([7, 7, 7]));
	});

	it('shares a notebook between two tabs in real time, with presence, and undoes only local edits', async () => {
		const storage = createMemoryStorage();
		const hub = createChannelHub();
		const a = start(storage, hub, { user: { name: 'Ada' } });
		await a.whenReady();
		await a.flush();
		const b = start(storage, hub, { user: { name: 'Bob' } });
		await b.whenReady();
		await settle();
		expect(b.getState().notebookId).toBe(a.getState().notebookId);
		await until(() => a.getState().peers.length === 1 && b.getState().peers.length === 1);
		expect(a.getState().peers[0]).toMatchObject({ name: 'Bob', pageId: a.getState().pageId });

		const mine = a.addText({ x: 10, y: 10 }, [para('from Ada')]);
		const theirs = b.addText({ x: 10, y: 200 }, [para('from Bob')]);
		await until(() => a.getState().containers.length === 2 && b.getState().containers.length === 2);
		b.focusContainer(theirs);
		await until(() => a.getState().peers[0]?.containerId === theirs);

		// Undo in Bob's tab removes Bob's container only.
		b.undo();
		await until(() => a.getState().containers.length === 1);
		expect(a.getState().containers[0]?.id).toBe(mine);
		expect(b.getState().containers.map((c) => c.id)).toEqual([mine]);

		// Notebook list changes reach the other tab too.
		const second = await a.createNotebook({ name: 'Second' });
		await until(() => b.getState().notebooks.some((n) => n.id === second));
		a.renameSection(a.getState().sectionId, 'Renamed in A');
		await until(() => a.getState().section?.name === 'Renamed in A');
	});

	it('deletes and restores notebooks, and applies a rename made while closed', async () => {
		const client = start(createMemoryStorage(), createChannelHub());
		await client.whenReady();
		const first = client.getState().notebookId;
		const second = await client.createNotebook({ name: 'Work' });
		expect(client.getState().notebookId).toBe(second);
		client.renameNotebook(first, 'Home');
		await settle();
		expect(client.getState().notebooks.map((n) => n.name)).toEqual(
			['Notebook', 'Work'].map((n) => (n === 'Notebook' ? 'Home' : n)),
		);
		await client.deleteNotebook(second);
		await settle();
		expect(client.getState().notebooks.map((n) => n.id)).toEqual([first]);
		expect(client.getState().notebookId).toBe(first);
		expect(client.getState().notebook?.name).toBe('Home');
		await client.restoreNotebook(second);
		await settle();
		expect(client.getState().notebooks.map((n) => n.name)).toEqual(['Home', 'Work']);
		client.moveNotebook(second, first);
		await settle();
		expect(client.getState().notebooks.map((n) => n.name)).toEqual(['Work', 'Home']);
	});

	it('searches, ticks to-dos, exports a page and round-trips an archive', async () => {
		const client = start(createMemoryStorage(), createChannelHub());
		await client.whenReady();
		client_addContent(client);
		client.renamePage(client.getState().pageId, 'Weekly');
		client.search('bob');
		await settle();
		expect(client.getState().searchResults.map((h) => h.where)).toEqual(['text']);
		const [todo] = client.getState().todos;
		client.setTodo(todo!, true);
		await settle();
		expect(client.getState().todos[0]?.done).toBe(true);

		const docx = await client.exportPage(undefined, { subtitle: 'Monday' });
		expect(docx.fileName).toBe('Weekly.docx');
		expect(docx.report.ink).toBe(0);
		expect(docx.report.skipped).toEqual([{ kind: 'ink', reason: 'no-rasterizer' }]);
		const loaded = await loadDocx(docx.bytes);
		expect(loaded.model.blocks).toHaveLength(5);

		const archive = await client.exportNotebook();
		expect(archive.fileName).toBe('Notebook.zip');
		const imported = await client.importNotebook(archive.bytes);
		await settle();
		const state = client.getState();
		expect(state.notebookId).toBe(imported);
		expect(state.notebooks).toHaveLength(2);
		expect(state.pages.map((p) => p.title)).toEqual(['Weekly']);
		expect(state.containers.map((c) => c.kind)).toEqual(['text', 'image']);
		expect(state.todos.map((t) => t.done)).toEqual([true]);
		await expect(client.importNotebook(new Uint8Array([1, 2]))).rejects.toThrow();
	});

	it('keeps a failed save unsaved and retries it on the next flush', async () => {
		const inner = createMemoryStorage();
		let fail = false;
		const storage: NotebookStorage = {
			load: inner.load,
			remove: inner.remove,
			save: async (key, bytes) => {
				if (fail) throw new Error('quota exceeded');
				return inner.save(key, bytes);
			},
		};
		const client = start(storage, createChannelHub());
		await client.whenReady();
		await client.flush();
		const notices: string[] = [];
		client.on('notice', (n) => notices.push(n.code));
		fail = true;
		client.renamePage(client.getState().pageId, 'Unsaved title');
		await expect(client.flush()).rejects.toThrow('quota exceeded');
		expect(notices).toContain('save-failed');
		expect(notices).not.toContain('sync-error');
		fail = false;
		await client.flush();
		const id = client.getState().notebookId;
		const reopened = start(storage, createChannelHub());
		await reopened.whenReady();
		await settle();
		expect(reopened.getState().notebookId).toBe(id);
		expect(reopened.getState().page?.title).toBe('Unsaved title');
	});
});

describe('notebook client with damaged input', () => {
	it('imports an archive whose text is malformed, keeping what is valid', async () => {
		const client = start(createMemoryStorage(), createChannelHub());
		await client.whenReady();
		await settle();
		client.addText({ x: 10, y: 10 }, [para('kept text')]);
		await settle();
		const zip = await JSZip.loadAsync((await client.exportNotebook()).bytes);
		const manifest = JSON.parse(await zip.file('notebook.json')!.async('string')) as {
			containers: { kind: string; content?: unknown[] }[];
		};
		const text = manifest.containers.find((c) => c.kind === 'text')!;
		text.content = [
			{ type: 'paragraph', content: 'not a list' },
			...(text.content ?? []),
			{ type: 'bullet_list', content: [null, { type: 'list_item', content: 5 }] },
			{ type: 'paragraph', content: [{ type: 'text', text: 42 }] },
		];
		zip.file('notebook.json', JSON.stringify(manifest));
		const before = client.getState().notebooks.length;
		const id = await client.importNotebook(await zip.generateAsync({ type: 'uint8array' }));
		await until(() => client.getState().notebookId === id && !client.getState().loading);
		expect(client.getState().notebooks).toHaveLength(before + 1);
		expect(client.getState().sections.length).toBeGreaterThan(0);
		client.search('kept text');
		await until(() => client.getState().searchResults.length === 1);
	});

	it('starts, opens and exports even when every save on the device fails', async () => {
		const failing: NotebookStorage = {
			load: async () => null,
			remove: async () => undefined,
			save: async () => {
				throw new Error('quota exceeded');
			},
		};
		const client = start(failing, createChannelHub());
		const notices: string[] = [];
		client.on('notice', (n) => notices.push(n.code));
		await client.whenReady();
		await settle();
		expect(client.getState().notebookId).not.toBe('');
		expect(client.getState().pages).toHaveLength(1);
		await expect(client.exportNotebook()).resolves.toMatchObject({ mime: 'application/zip' });
		expect(notices).toContain('save-failed');
	});
});

function client_addContent(client: NotebookClient): void {
	client.addText({ x: 20, y: 40 }, [para('Agenda'), para('Call Bob', 'open')]);
	client.addImage({
		x: 300,
		y: 40,
		width: 100,
		height: 50,
		name: 'pic.png',
		mime: 'image/png',
		bytes: new Uint8Array([7, 7, 7]),
	});
	client.addStroke({ tool: 'pen', color: '#000000', width: 2, points: [0, 0, 0.5, 30, 30, 0.5] });
}
