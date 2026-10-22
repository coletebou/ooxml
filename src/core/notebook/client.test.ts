import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDocx } from '../docx/parse';
import { createNotebookClient } from './client';
import type { NotebookClient, NotebookClientOptions } from './client-types';
import { type NotebookStorage, REGISTRY_KEY, createMemoryStorage } from './storage';
import { notebookRoomId, sanitizeScope } from './sync';
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

/** A storage whose saves fail while `control.fail` is set. */
function flaky() {
	const inner = createMemoryStorage();
	const control = { fail: false };
	const storage: NotebookStorage = {
		load: inner.load,
		remove: inner.remove,
		save: async (key, bytes) => {
			if (control.fail) throw new Error('quota exceeded');
			return inner.save(key, bytes);
		},
	};
	return { inner, storage, control };
}

const opened = (client: NotebookClient, id: string) =>
	until(() => client.getState().notebookId === id && !client.getState().loading);

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

describe('notebook client when storage fails or is missing', () => {
	it('keeps the open notebook when its last changes cannot be saved, instead of switching', async () => {
		const { storage, control } = flaky();
		const client = start(storage, createChannelHub());
		await client.whenReady();
		await settle();
		const first = client.getState().notebookId;
		const second = await client.createNotebook({ name: 'Second' });
		await opened(client, second);
		await client.openNotebook(first);
		await opened(client, first);
		control.fail = true;
		client.renamePage(client.getState().pageId, 'Unsaved title');
		await client.openNotebook(second);
		await settle();
		expect(client.getState().notebookId).toBe(first);
		expect(client.getState().page?.title).toBe('Unsaved title');
		// Once saving works again the switch goes through and the change was kept.
		control.fail = false;
		await client.openNotebook(second);
		await opened(client, second);
		await client.openNotebook(first);
		await opened(client, first);
		expect(client.getState().page?.title).toBe('Unsaved title');
	});

	it('keeps closed notebooks for the session when no storage is given', async () => {
		const client = createNotebookClient({
			user: { name: 'Ada' },
			BroadcastChannel: createChannelHub(),
			saveDelayMs: 5,
		});
		clients.push(client);
		await client.whenReady();
		await settle();
		const first = client.getState().notebookId;
		client.renamePage(client.getState().pageId, 'Kept');
		const second = await client.createNotebook({ name: 'Second' });
		await opened(client, second);
		await client.openNotebook(first);
		await opened(client, first);
		expect(client.getState().page?.title).toBe('Kept');
		expect(client.getState().sections).toHaveLength(1);
	});

	it('neither replaces nor adds to a notebook list it could not read', async () => {
		const inner = createMemoryStorage();
		const before = start(inner, createChannelHub());
		await before.whenReady();
		await settle();
		await before.flush();
		await before.destroy();
		const stored = await inner.load(REGISTRY_KEY);
		expect(stored?.length).toBeGreaterThan(0);
		const storage: NotebookStorage = {
			...inner,
			load: async (key) => {
				if (key === REGISTRY_KEY) throw new Error('read failed');
				return inner.load(key);
			},
		};
		const notices: string[] = [];
		const client = start(storage, createChannelHub());
		client.on('notice', (n) => notices.push(n.code));
		await client.whenReady();
		await settle();
		expect(client.getState().notebooks).toEqual([]);
		expect(notices).toContain('open-failed');
		// A notebook made now could not be listed, so none is made.
		await expect(client.createNotebook({ name: 'Made while unreadable' })).rejects.toThrow();
		expect(client.getState().notebooks).toEqual([]);
		await client.flush().catch(() => undefined);
		expect(await inner.load(REGISTRY_KEY)).toEqual(stored);
	});

	it('does not open a notebook whose stored copy cannot be read, so nothing is saved over it', async () => {
		const inner = createMemoryStorage();
		const before = start(inner, createChannelHub());
		await before.whenReady();
		await settle();
		const id = before.getState().notebookId;
		before.renamePage(before.getState().pageId, 'On disk');
		await before.flush();
		await before.destroy();
		const key = `notebook:${id}`;
		const stored = await inner.load(key);
		const storage: NotebookStorage = {
			...inner,
			load: async (k) => {
				if (k === key) throw new Error('read failed');
				return inner.load(k);
			},
		};
		const notices: string[] = [];
		const client = start(storage, createChannelHub());
		client.on('notice', (n) => notices.push(n.code));
		await client.whenReady();
		await settle(20);
		expect(client.getState().notebook).toBeNull();
		expect(notices).toContain('open-failed');
		expect(await inner.load(key)).toEqual(stored);
	});

	it('reports whether the device keeps what is saved', async () => {
		const memory = start(createMemoryStorage(), createChannelHub());
		await memory.whenReady();
		expect(memory.getState().persistent).toBe(false);
		const { storage } = flaky();
		const kept = start({ ...storage, persistent: () => true }, createChannelHub());
		await kept.whenReady();
		expect(kept.getState().persistent).toBe(true);
	});
});

describe('notebook client switching and adding', () => {
	it('runs quick notebook switches one after another, leaving one session open', async () => {
		const hub = createChannelHub();
		const client = start(createMemoryStorage(), hub);
		await client.whenReady();
		await settle();
		const first = client.getState().notebookId;
		const second = await client.createNotebook({ name: 'Second' });
		await opened(client, second);
		const settled = hub.open();
		await Promise.all([
			client.openNotebook(first),
			client.openNotebook(second),
			client.openNotebook(first),
		]);
		await opened(client, first);
		await settle(20);
		expect(hub.open()).toBe(settled);
	});

	it('adds to the page it was asked for, and to nothing once that page is in another notebook', async () => {
		const client = start(createMemoryStorage(), createChannelHub());
		await client.whenReady();
		await settle();
		const original = client.getState().pageId;
		const other = client.createPage({ title: 'Other' });
		await settle();
		expect(client.getState().pageId).toBe(other);
		const input = {
			x: 10,
			y: 10,
			width: 40,
			height: 40,
			name: 'a.png',
			mime: 'image/png',
			bytes: new Uint8Array([1]),
		};
		expect(client.addImage(input, original)).not.toBe('');
		expect(client.getState().containers).toHaveLength(0);
		client.selectPage(original);
		await settle();
		expect(client.getState().containers).toHaveLength(1);
		const second = await client.createNotebook({ name: 'Second' });
		await opened(client, second);
		expect(client.addImage(input, original)).toBe('');
		expect(client.addText({ x: 0, y: 0 }, undefined, original)).toBe('');
	});
});

describe('notebook client fourth review round', () => {
	it('keeps a notebook whose last changes cannot be saved instead of deleting it', async () => {
		const { storage, control } = flaky();
		const client = start(storage, createChannelHub());
		await client.whenReady();
		await settle();
		const id = client.getState().notebookId;
		control.fail = true;
		client.renamePage(client.getState().pageId, 'Unsaved');
		expect(await client.deleteNotebook(id)).toBe(false);
		expect(client.getState().notebookId).toBe(id);
		expect(client.getState().notebooks.map((n) => n.id)).toEqual([id]);
		await until(() => client.getState().unsaved);
		control.fail = false;
		client.renamePage(client.getState().pageId, 'Saved now');
		await until(() => !client.getState().unsaved);
		expect(await client.deleteNotebook(id)).toBe(true);
	});

	it('ticks a to-do nested as deep as the editor allows', async () => {
		const client = start(createMemoryStorage(), createChannelHub());
		await client.whenReady();
		await settle();
		let block: object = para('deep task', 'open');
		for (let i = 0; i < 10; i++)
			block = { type: 'bullet_list', content: [{ type: 'list_item', content: [block] }] };
		client.addText({ x: 0, y: 0 }, [block as never]);
		await until(() => client.getState().todos.length === 1);
		client.setTodo(client.getState().todos[0]!, true);
		await until(() => client.getState().todos[0]?.done === true);
	});

	it('leaves a notebook another tab deleted', async () => {
		const hub = createChannelHub();
		const ada = start(createMemoryStorage(), hub);
		await ada.whenReady();
		await settle(50);
		const bob = start(createMemoryStorage(), hub);
		await bob.whenReady();
		const id = ada.getState().notebookId;
		await until(() => bob.getState().notebookId === id && !bob.getState().loading);
		expect(await ada.deleteNotebook(id)).toBe(true);
		await until(() => bob.getState().notebook === null);
	});
});

describe('notebook client keeps what it could not save', () => {
	it('keeps a notebook made while saves fail listed for the next client on that storage', async () => {
		const { storage, control } = flaky();
		const named = { ...storage, id: `db-${Math.random().toString(36).slice(2)}` };
		const first = start(named, createChannelHub());
		await first.whenReady();
		await settle();
		control.fail = true;
		const made = await first.createNotebook({ name: 'Made offline' });
		await first.destroy();
		control.fail = false;
		const second = start({ ...named }, createChannelHub());
		await second.whenReady();
		await settle();
		expect(second.getState().notebooks.map((n) => n.id)).toContain(made);
	});

	it('brings back changes a closed client could not save, for the next client on that storage', async () => {
		const { storage, control } = flaky();
		const named = { ...storage, id: `db-${Math.random().toString(36).slice(2)}` };
		const first = start(named, createChannelHub());
		await first.whenReady();
		await settle();
		const id = first.getState().notebookId;
		control.fail = true;
		first.renamePage(first.getState().pageId, 'Kept in the tab');
		await first.destroy();
		control.fail = false;
		const second = start({ ...named }, createChannelHub());
		await second.whenReady();
		await until(() => second.getState().notebookId === id && !second.getState().loading);
		expect(second.getState().page?.title).toBe('Kept in the tab');
	});
});

describe('notebook client undo of deletes', () => {
	it('undoes deleting a page that has a text box on it', async () => {
		const client = start(createMemoryStorage(), createChannelHub());
		await client.whenReady();
		await settle();
		const page = client.createPage({ title: 'With a box' });
		client.addText({ x: 0, y: 0 }, [para('on the page')]);
		await settle(20);
		client.deletePage(page);
		await until(() => !client.getState().pages.some((p) => p.id === page));
		await settle(20);
		client.undo();
		await until(() => client.getState().pages.some((p) => p.id === page));
	});
});

describe('notebook client tenth review round', () => {
	it('keeps both clients edits when they share a storage but cannot sync', async () => {
		const shared = createMemoryStorage();
		const a = start(shared, createChannelHub());
		await a.whenReady();
		await settle();
		const id = a.getState().notebookId;
		await a.flush();
		const b = start(shared, createChannelHub());
		await b.whenReady();
		await until(() => b.getState().notebookId === id && !b.getState().loading);
		a.renamePage(a.getState().pageId, 'From A');
		b.createPage({ title: 'From B' });
		await a.flush();
		await b.flush();
		await a.destroy();
		await b.destroy();
		const c = start(shared, createChannelHub());
		await c.whenReady();
		await until(() => c.getState().notebookId === id && !c.getState().loading);
		expect(
			c
				.getState()
				.pages.map((p) => p.title)
				.sort(),
		).toEqual(['From A', 'From B']);
	});

	it('joins a notebook made on another device by its id in server mode', async () => {
		class Socket {
			readyState = 0;
			binaryType = 'arraybuffer';
			onopen = null;
			onclose = null;
			onerror = null;
			onmessage = null;
			send(): void {}
			close(): void {}
		}
		const client = start(createMemoryStorage(), createChannelHub(), {
			config: { mode: 'server', syncUrl: 'wss://sync.test' },
			WebSocket: Socket as never,
		});
		await client.whenReady();
		await settle();
		await client.openNotebook('nshared0123456789');
		await until(() => client.getState().notebookId === 'nshared0123456789');
		expect(client.getState().notebooks.map((n) => n.id)).toContain('nshared0123456789');
	});
});

describe('notebook client eleventh review round', () => {
	it('keeps notebooks listed by another client on the same storage that it cannot reach', async () => {
		const shared = createMemoryStorage();
		const a = start(shared, createChannelHub());
		await a.whenReady();
		await settle();
		await a.flush();
		const b = start(shared, createChannelHub());
		await b.whenReady();
		await settle();
		await a.createNotebook({ name: 'From A' });
		await a.flush();
		await b.createNotebook({ name: 'From B' });
		await b.flush();
		await a.destroy();
		await b.destroy();
		const c = start(shared, createChannelHub());
		await c.whenReady();
		await settle();
		const names = c.getState().notebooks.map((n) => n.name);
		expect(names).toContain('From A');
		expect(names).toContain('From B');
	});

	it.each([
		['reads and then writes', false],
		['updates in one step', true],
	])(
		'fails a save whose stored copy cannot be read instead of writing over it (%s)',
		async (_, atomic) => {
			const inner = createMemoryStorage();
			const control = { failLoad: false };
			const unreadable = (key: string) => control.failLoad && key.startsWith('notebook:');
			const storage: NotebookStorage = {
				save: inner.save,
				remove: inner.remove,
				load: async (key) => {
					if (unreadable(key)) throw new Error('read failed');
					return inner.load(key);
				},
				...(atomic
					? {
							update: async (key, change) => {
								if (unreadable(key)) throw new Error('read failed');
								return inner.update(key, change);
							},
						}
					: {}),
			};
			const client = start(storage, createChannelHub());
			await client.whenReady();
			await settle();
			const key = `notebook:${client.getState().notebookId}`;
			await client.flush();
			const stored = await inner.load(key);
			control.failLoad = true;
			client.renamePage(client.getState().pageId, 'Not yet saved');
			await expect(client.flush()).rejects.toThrow('read failed');
			expect(await inner.load(key)).toEqual(stored);
			// The change stays unsaved, so the next flush once the copy reads again saves it.
			control.failLoad = false;
			await client.flush();
			expect(await inner.load(key)).not.toEqual(stored);
		},
	);
});

describe('notebook client twelfth review round', () => {
	it('keeps both clients edits and notebooks when they save to one storage at the same time', async () => {
		const shared = createMemoryStorage();
		const a = start(shared, createChannelHub());
		await a.whenReady();
		await settle();
		const id = a.getState().notebookId;
		await a.flush();
		const b = start(shared, createChannelHub());
		await b.whenReady();
		await until(() => b.getState().notebookId === id && !b.getState().loading);
		a.renamePage(a.getState().pageId, 'From A');
		b.createPage({ title: 'From B' });
		await Promise.all([a.flush(), b.flush()]);
		const madeA = await a.createNotebook({ name: 'Listed by A' });
		const madeB = await b.createNotebook({ name: 'Listed by B' });
		await Promise.all([a.flush(), b.flush()]);
		await Promise.all([a.destroy(), b.destroy()]);
		const c = start(shared, createChannelHub());
		await c.whenReady();
		await settle();
		expect(c.getState().notebooks.map((n) => n.id)).toEqual(
			expect.arrayContaining([id, madeA, madeB]),
		);
		await c.openNotebook(id);
		await until(() => c.getState().notebookId === id && !c.getState().loading);
		expect(
			c
				.getState()
				.pages.map((p) => p.title)
				.sort(),
		).toEqual(['From A', 'From B']);
	});

	it('selects the neighbour of a page or section that is deleted, not the first one', async () => {
		const client = start(createMemoryStorage(), createChannelHub());
		await client.whenReady();
		await settle();
		const state = async () => {
			await settle();
			return client.getState();
		};
		const first = (await state()).pageId;
		const second = client.createPage({ title: 'Second', afterId: first });
		const third = client.createPage({ title: 'Third', afterId: second });
		const fourth = client.createPage({ title: 'Fourth', afterId: third });
		client.selectPage(third);
		expect((await state()).pages.map((p) => p.id)).toEqual([first, second, third, fourth]);
		client.deletePage(third);
		expect((await state()).pageId).toBe(fourth);
		// The last page's neighbour is the one before it.
		client.deletePage(fourth);
		expect((await state()).pageId).toBe(second);
		const s1 = (await state()).sectionId;
		const s2 = client.createSection({ name: 'Two' });
		const s3 = client.createSection({ name: 'Three' });
		client.selectSection(s2);
		expect((await state()).sections.map((s) => s.id)).toEqual([s1, s2, s3]);
		expect(client.getState().sectionId).toBe(s2);
		client.deleteSection(s2);
		expect((await state()).sectionId).toBe(s3);
	});

	it('gives every notebook id its own room, also the longest ones', () => {
		const base = 'n'.repeat(125);
		const ids = [`${base}abc`, `${base}abd`, 'nshort'];
		const rooms = ids.map(notebookRoomId);
		expect(new Set(rooms).size).toBe(ids.length);
		for (const room of rooms) expect(room.length <= 128 && /^[\w-]+$/u.test(room)).toBe(true);
		expect(notebookRoomId('nshort')).toBe('nb-nshort');
	});

	it('gives every scope its own room, also scopes that are not plain ids', () => {
		const scopes = ['alice@example.com', 'bob@example.com', 'x'.repeat(60), `${'x'.repeat(60)}y`];
		const rooms = scopes.map(sanitizeScope);
		expect(new Set(rooms).size).toBe(scopes.length);
		for (const room of rooms)
			expect(room && room.length <= 48 && /^[\w-]+$/u.test(room)).toBe(true);
		expect(sanitizeScope('profile-1')).toBe('profile-1');
		expect(sanitizeScope('')).toBe('');
		expect(sanitizeScope(7)).toBe('');
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

describe('notebook client names', () => {
	it('names new notebooks and sections in the language set later', async () => {
		const client = start(createMemoryStorage(), createChannelHub());
		await client.whenReady();
		await settle();
		client.setNames({ notebook: 'Notizbuch', section: 'Abschnitt', group: ' ' });
		client.createSection();
		await settle();
		expect(client.getState().sections.map((s) => s.name)).toEqual(['Section 1', 'Abschnitt 2']);
		const id = await client.createNotebook();
		await opened(client, id);
		expect(client.getState().notebook?.name).toBe('Notizbuch 2');
		expect(client.getState().sections.map((s) => s.name)).toEqual(['Abschnitt 1']);
	});
});
