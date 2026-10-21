// The framework-neutral notebook client every UI binds to (see `client-types.ts`). It owns the
// device's notebook list and the one open notebook, keeps the selection valid whatever peers do
// (a deleted page selects its neighbour), and turns every button into a plain action. DOM-free:
// storage, WebSocket and BroadcastChannel are injectable. New code.
import { Emitter } from '../collab/emitter';
import { createIdGenerator, randomToken } from '../collab/identity';
import { DEFAULT_COLOR } from '../collab/validation';
import * as canvas from './canvas';
import { exportArchive, exportPage, readArchive } from './client-export';
import { createRegistryStore } from './client-registry';
import type {
	NotebookClient,
	NotebookClientOptions,
	NotebookEvents,
	NotebookNoticeCode,
	NotebookState,
} from './client-types';
import { isEntityId } from './model';
import { createMemoryStorage } from './storage';
import { paletteColor } from './palette';
import { readContainers, readMeta, readPages, readSections, readStrokes } from './read';
import { containerFragment, entityMap } from './schema';
import {
	moveInRegistry,
	readRegistry,
	registerNotebook,
	unregisterNotebook,
	updateRegistry,
} from './registry';
import { type OpenNotebook, openNotebook } from './session';
import { writeSnapshot } from './snapshot';
import * as structure from './structure';
import { sanitizeScope } from './sync';
import { collectTodos, searchNotebook, setTodoState } from './text-index';
import { notebookPages, pageViews, peerViews, sectionViews } from './views';

export function createNotebookClient(options: NotebookClientOptions): NotebookClient {
	const now = options.now ?? Date.now;
	const config = options.config ?? { mode: 'local' as const };
	const classes = { WebSocket: options.WebSocket, BroadcastChannel: options.BroadcastChannel };
	const user = {
		id: isEntityId(options.user.id) ? options.user.id : `u${randomToken()}${randomToken()}`,
		name: options.user.name.trim().slice(0, 80) || 'Anonymous',
	};
	const names = { notebook: 'My Notebook', section: 'New Section', group: 'Section Group' };
	const setNames = (input: NotebookClientOptions['names'] = {}): void => {
		for (const key of ['notebook', 'section', 'group'] as const) {
			const value = input[key];
			if (typeof value === 'string' && value.trim()) names[key] = value.trim().slice(0, 80);
		}
	};
	setNames(options.names);
	const newId = createIdGenerator(randomToken(), 'nb');
	const notices = new Emitter<NotebookEvents>();
	const notice = (code: NotebookNoticeCode, error?: unknown): void =>
		notices.emit('notice', error instanceof Error ? { code, detail: error.message } : { code });
	const listeners = new Set<() => void>();

	let open: OpenNotebook | null = null;
	let loading = false;
	let ready = false;
	let destroyed = false;
	let sectionId = '';
	let pageId = '';
	let focused = '';
	let query = '';
	let queued = false;

	// Without a storage the notebooks still live for the session: closing one must not lose it.
	const storage = options.storage ?? createMemoryStorage();
	// Saves the device refused and not yet made good (the notebook's and the list's).
	const unsaved = { notebook: false, registry: false };
	const registry = createRegistryStore({
		storage,
		scope: sanitizeScope(options.scope),
		userName: user.name,
		BroadcastChannel: options.BroadcastChannel,
		now,
		onChange: () => refresh(),
		onError: (error, kind) => {
			if (kind === 'save') {
				unsaved.registry = true;
				refresh();
			}
			notice(kind === 'load' ? 'open-failed' : 'save-failed', error);
		},
		onSaved: () => {
			if (unsaved.registry) {
				unsaved.registry = false;
				refresh();
			}
		},
	});
	const reg = registry.doc;

	const compute = (): NotebookState => {
		const notebooks = readRegistry(reg)
			.filter((e) => !e.deleted)
			.map(({ lastSection: _s, lastPage: _p, pending: _n, ...e }) => e);
		const base = {
			ready,
			loading,
			mode: config.mode,
			persistent: storage.persistent?.() ?? true,
			unsaved: unsaved.notebook || unsaved.registry,
			user: {
				...user,
				color: open?.session.identity.userColor ?? options.user.color ?? DEFAULT_COLOR,
			},
			notebooks,
			canUndo: !!open?.undo.canUndo(),
			canRedo: !!open?.undo.canRedo(),
			searchQuery: query,
		};
		if (!open) {
			return {
				...base,
				status: 'closed',
				notebookId: '',
				notebook: null,
				sections: [],
				sectionId: '',
				section: null,
				pages: [],
				pageId: '',
				page: null,
				containers: [],
				strokes: [],
				peers: [],
				searchResults: [],
				todos: [],
			};
		}
		const { types } = open;
		const allPages = readPages(types);
		const sections = sectionViews(readSections(types), allPages);
		const section =
			sections.find((s) => s.id === sectionId && s.kind === 'section') ??
			sections.find((s) => s.kind === 'section') ??
			null;
		sectionId = section?.id ?? '';
		const pages = pageViews(allPages, sectionId);
		const page = pages.find((p) => p.id === pageId) ?? pages[0] ?? null;
		pageId = page?.id ?? '';
		const visible = notebookPages(sections, allPages);
		return {
			...base,
			status: open.session.status,
			notebookId: open.id,
			notebook: { ...readMeta(types), id: open.id },
			sections,
			sectionId,
			section,
			pages,
			pageId,
			page,
			containers: page ? readContainers(types, page.id) : [],
			strokes: page ? readStrokes(types, page.id) : [],
			peers: peerViews(open.session.peers()),
			searchResults: query ? searchNotebook(open.index, visible, query) : [],
			todos: collectTodos(open.index, visible),
		};
	};

	let state = compute();
	let remembered = '';
	let mirrored = '';
	function refresh(): void {
		if (queued || destroyed) return;
		queued = true;
		queueMicrotask(() => {
			queued = false;
			if (destroyed) return;
			state = compute();
			afterCompute();
			for (const l of [...listeners]) l();
		});
	}

	/** Side effects of a new state: remember the position, publish presence, mirror the name. */
	function afterCompute(): void {
		if (!open) return;
		const key = `${open.id}|${state.sectionId}|${state.pageId}`;
		if (key !== remembered) {
			remembered = key;
			updateRegistry(reg, open.id, { lastSection: state.sectionId, lastPage: state.pageId });
			open.session.updatePresence({ pageId: state.pageId });
		}
		const entry = readRegistry(reg).find((e) => e.id === open!.id);
		// Deleted in another tab: leave it, as deleting it here does.
		if (!entry || entry.deleted) return void leaveDeleted(open.id);
		const meta = state.notebook;
		// The list follows the notebook's own name when that changes, not on every refresh: two tabs
		// whose copies disagree (a sync server away) would otherwise write the list back and forth.
		const named = meta ? `${open.id}|${meta.name}|${meta.color}` : '';
		if (named === mirrored) return;
		mirrored = named;
		if (
			meta &&
			open.types.meta.size &&
			!entry.pending &&
			(entry.name !== meta.name || entry.color !== meta.color)
		)
			updateRegistry(reg, open.id, { name: meta.name, color: meta.color });
	}

	let leaving = '';
	async function leaveDeleted(id: string): Promise<void> {
		if (leaving === id) return;
		leaving = id;
		const next = readRegistry(reg).find((e) => !e.deleted && e.id !== id);
		if (next) await switchTo(next.id);
		else if (open?.id === id) {
			const previous = open;
			open = null;
			await previous.close();
			refresh();
		}
		leaving = '';
	}

	const discrete = <T>(fn: (o: OpenNotebook) => T, fallback: T): T => {
		if (!open || destroyed) return fallback;
		open.undo.stopCapturing();
		const out = fn(open);
		open.undo.stopCapturing();
		refresh();
		return out;
	};

	// One switch at a time: two quick picks would otherwise both close the same notebook and both
	// open one, leaving a session nobody closes (a phantom peer in its room).
	let switching: Promise<void> = Promise.resolve();
	function switchTo(
		id: string,
		seed?: (ctx: structure.NotebookEditContext) => void,
		options: { force?: boolean } = {},
	): Promise<void> {
		const run = switching.then(() => switchNow(id, seed, options));
		switching = run.catch(() => undefined);
		return run;
	}

	async function switchNow(
		id: string,
		seed?: (ctx: structure.NotebookEditContext) => void,
		{ force = false }: { force?: boolean } = {},
	): Promise<void> {
		const entry = readRegistry(reg).find((e) => e.id === id && !e.deleted);
		if (!entry || destroyed || open?.id === id) return;
		const previous = open;
		// The open notebook closes only once its last changes are saved. When the device refuses them
		// (storage full), it stays open, so nothing typed since is lost (save-failed says why); only
		// deleting it switches anyway.
		if (previous && !force) {
			try {
				await previous.flush();
			} catch {
				return;
			}
		}
		loading = true;
		refresh();
		open = null;
		await previous?.close();
		try {
			const next = await openNotebook({
				id,
				storage,
				config,
				classes,
				user: { ...user, ...(options.user.color ? { color: options.user.color } : {}) },
				newId,
				now,
				saveDelayMs: options.saveDelayMs ?? 400,
				...(seed ? { seed } : {}),
				onChange: () => refresh(),
				onError: (error, kind) => {
					if (kind === 'save') {
						unsaved.notebook = true;
						refresh();
					}
					notice(
						kind === 'save' ? 'save-failed' : kind === 'load' ? 'open-failed' : 'sync-error',
						error,
					);
				},
				onSaved: () => {
					if (unsaved.notebook) {
						unsaved.notebook = false;
						refresh();
					}
				},
			});
			if (destroyed) return void (await next.close());
			if (entry.pending) {
				structure.writeMeta(next.seed, { name: entry.name, color: entry.color });
				updateRegistry(reg, id, { pending: false });
			}
			open = next;
			sectionId = entry.lastSection;
			pageId = entry.lastPage;
			focused = '';
		} catch (error) {
			notice('open-failed', error);
		} finally {
			loading = false;
			refresh();
		}
	}

	async function create(
		input: { name?: string; color?: string },
		seed?: (ctx: structure.NotebookEditContext) => void,
	): Promise<string> {
		// A notebook made now could not be listed: the stored list was not readable and is left alone.
		if (registry.readFailed()) {
			notice('open-failed');
			throw new Error('The notebook list could not be read.');
		}
		const id = `n${randomToken()}${randomToken()}`;
		const count = readRegistry(reg).length;
		const name = input.name?.trim() || (count ? `${names.notebook} ${count + 1}` : names.notebook);
		const color = input.color ?? paletteColor(count);
		registerNotebook(reg, { id, name, color, created: now() });
		// A failed save is announced (save-failed) and retried; the notebook still opens.
		await registry.flush().catch(() => undefined);
		await switchTo(
			id,
			seed ??
				((ctx) => {
					structure.writeMeta(ctx, { name, color });
					const section = structure.addSection(ctx, { name: `${names.section} 1` });
					structure.addPage(ctx, { sectionId: section });
				}),
		);
		if (open?.id !== id && !destroyed) {
			// It could not be opened or seeded, or the open notebook could not be saved first
			// (switchTo said why): leave no empty notebook in the list, and keep or reopen one.
			unregisterNotebook(reg, id);
			await registry.flush().catch(() => undefined);
			const fallback = open ? null : readRegistry(reg).find((e) => !e.deleted);
			if (fallback) await switchTo(fallback.id);
			throw new Error('The notebook could not be created.');
		}
		return id;
	}

	const started = (async () => {
		await registry.start();
		if (destroyed) return;
		ready = true;
		const first = readRegistry(reg).find((e) => !e.deleted);
		if (first) await switchTo(first.id);
		// A first notebook that cannot be made was announced (open-failed); the client still starts.
		// A list that could not be read gets no new default notebook (it would hide the stored ones).
		else if (options.createDefault !== false && !registry.readFailed())
			await create({}).catch(() => undefined);
		refresh();
	})();

	/** Adds to `page` (default the selected one) while it is in the open notebook; else nothing. */
	const onPage = (
		page: string | undefined,
		fn: (o: OpenNotebook, target: string) => string,
	): string =>
		discrete((o) => {
			const target = page ?? pageId;
			return readPages(o.types).some((p) => p.id === target) ? fn(o, target) : '';
		}, '');

	const onSelected = (fn: (o: OpenNotebook, page: string) => void): void => {
		if (open && pageId) discrete((o) => fn(o, pageId), undefined);
	};

	return {
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		on: (event, listener) => notices.on(event, listener),
		whenReady: () => started,

		createNotebook: (input = {}) => create(input),
		setNames,
		openNotebook: async (id) => {
			if (open?.id === id) return;
			// In server mode a notebook made on another device can be joined by its id: it is listed
			// here first (its name follows from the room once it syncs).
			if (
				config.mode === 'server' &&
				isEntityId(id) &&
				!readRegistry(reg).some((e) => e.id === id) &&
				!registry.readFailed()
			)
				registerNotebook(reg, { id, name: names.notebook, color: paletteColor(0), created: now() });
			await switchTo(id);
		},
		renameNotebook(id, name) {
			if (open?.id === id) discrete((o) => structure.writeMeta(o.edit, { name }), undefined);
			updateRegistry(reg, id, { name, ...(open?.id === id ? {} : { pending: true }) });
		},
		setNotebookColor(id, color) {
			if (open?.id === id) discrete((o) => structure.writeMeta(o.edit, { color }), undefined);
			updateRegistry(reg, id, { color, ...(open?.id === id ? {} : { pending: true }) });
		},
		moveNotebook: (id, beforeId) => void moveInRegistry(reg, id, beforeId),
		async deleteNotebook(id) {
			// Its last changes are saved first: a restore would otherwise bring back an older copy.
			if (open?.id === id) {
				try {
					await open.flush();
				} catch {
					return false;
				}
			}
			updateRegistry(reg, id, { deleted: now() });
			if (open?.id !== id) return true;
			const next = readRegistry(reg).find((e) => !e.deleted);
			if (next) await switchTo(next.id, undefined, { force: true });
			else {
				const previous = open;
				open = null;
				await previous.close();
				refresh();
			}
			return true;
		},
		async restoreNotebook(id) {
			updateRegistry(reg, id, { deleted: null });
			if (!open) await switchTo(id);
		},

		createSection: (input = {}) =>
			discrete((o) => {
				const kind = input.kind ?? 'section';
				const count = readSections(o.types).filter((s) => s.kind === kind).length + 1;
				const id = structure.addSection(o.edit, {
					kind,
					name: input.name?.trim() || `${kind === 'group' ? names.group : names.section} ${count}`,
					...(input.color ? { color: input.color } : {}),
					...(input.parentId ? { parentId: input.parentId } : {}),
				});
				if (kind === 'section') {
					structure.addPage(o.edit, { sectionId: id });
					sectionId = id;
					pageId = '';
				}
				return id;
			}, ''),
		selectSection(id) {
			if (id === sectionId) return;
			sectionId = id;
			pageId = '';
			focused = '';
			refresh();
		},
		renameSection: (id, name) =>
			discrete((o) => void structure.updateSection(o.edit, id, { name }), undefined),
		setSectionColor: (id, color) =>
			discrete((o) => void structure.updateSection(o.edit, id, { color }), undefined),
		moveSection: (id, target) =>
			discrete((o) => void structure.moveSection(o.edit, id, target), undefined),
		deleteSection: (id) => discrete((o) => structure.deleteSection(o.edit, id), null),

		createPage: (input = {}) =>
			discrete((o) => {
				const section = input.sectionId ?? sectionId;
				const after = input.afterId ?? (input.subpage ? pageId : undefined);
				const afterPage = readPages(o.types).find((p) => p.id === after);
				const id = structure.addPage(o.edit, {
					sectionId: section,
					...(input.title ? { title: input.title } : {}),
					...(after ? { afterId: after } : {}),
					...(input.subpage && afterPage
						? { level: Math.min(2, afterPage.level + 1) as 0 | 1 | 2 }
						: {}),
				});
				if (id) {
					sectionId = section;
					pageId = id;
				}
				return id;
			}, ''),
		selectPage(id) {
			pageId = id;
			focused = '';
			refresh();
		},
		renamePage(id, title) {
			// Not discrete: typing a title merges into one undo step, like typing text.
			if (open && structure.renamePage(open.edit, id, title)) refresh();
		},
		movePage: (id, target) =>
			discrete((o) => void structure.movePage(o.edit, id, target), undefined),
		indentPage: (id, delta) =>
			discrete((o) => void structure.shiftPageLevel(o.edit, id, delta), undefined),
		deletePage: (id) => discrete((o) => structure.deletePage(o.edit, id), null),
		restore: (batch) => discrete((o) => void structure.restoreBatch(o.edit, batch), undefined),

		addText: (at, content, page) =>
			onPage(page, (o, target) =>
				canvas.addText(o.edit, target, { ...at, ...(content ? { content } : {}) }),
			),
		addImage: (input, page) =>
			onPage(
				page,
				(o, target) => canvas.addImage(o.edit, target, input) || (notice('file-too-large'), ''),
			),
		addFile: (input, page) =>
			onPage(
				page,
				(o, target) => canvas.addFile(o.edit, target, input) || (notice('file-too-large'), ''),
			),
		moveContainers: (ids, dx, dy) => onSelected((o) => canvas.moveContainers(o.edit, ids, dx, dy)),
		resizeContainer: (id, size) => onSelected((o) => canvas.resizeContainer(o.edit, id, size)),
		bringToFront: (id) => onSelected((o) => canvas.bringToFront(o.edit, id)),
		deleteContainers: (ids) => onSelected((o) => canvas.deleteContainers(o.edit, ids)),
		addStroke: (input) => discrete((o) => canvas.addStroke(o.edit, pageId, input), ''),
		eraseStrokes: (ids) => onSelected((o) => canvas.deleteStrokes(o.edit, ids)),
		containerBytes: (id) => (open ? canvas.containerBytes(open.edit, id) : null),
		textBinding(id) {
			const map = open && entityMap(open.types.containers, id);
			const fragment = map && containerFragment(map);
			if (!open || !fragment) return null;
			const { identity } = open.session;
			return {
				fragment,
				undo: open.undo,
				awareness: open.session.awareness,
				user: { name: identity.userName, color: identity.userColor },
			};
		},
		focusContainer(id) {
			const next = id ?? '';
			if (next === focused || !open) return;
			focused = next;
			open.session.updatePresence({ containerId: next });
		},
		setTodo: (item, done) =>
			discrete(
				(o) => void setTodoState(o.types, o.edit.origin, item, done ? 'done' : 'open'),
				undefined,
			),

		undo: () => discrete((o) => void o.undo.undo(), undefined),
		redo: () => discrete((o) => void o.undo.redo(), undefined),
		search(next) {
			query = next.slice(0, 200);
			refresh();
		},

		async exportPage(id, exportOptions = {}) {
			if (!open) throw new Error('No notebook is open');
			try {
				return await exportPage(open, id ?? pageId, exportOptions);
			} catch (error) {
				notice('export-failed', error);
				throw error;
			}
		},
		async exportNotebook() {
			if (!open) throw new Error('No notebook is open');
			// The archive is built from the open document; a save that failed was announced already.
			await open.flush().catch(() => undefined);
			return exportArchive(open);
		},
		async importNotebook(bytes) {
			let snapshot;
			try {
				snapshot = await readArchive(bytes);
			} catch (error) {
				notice('import-failed', error);
				throw error;
			}
			return create(
				{ name: snapshot.name, color: snapshot.color },
				(ctx) => void writeSnapshot(ctx, snapshot),
			);
		},

		async flush() {
			await Promise.all([registry.flush(), open?.flush()]);
		},
		async destroy() {
			if (destroyed) return;
			destroyed = true;
			listeners.clear();
			await started.catch(() => undefined);
			const last = open;
			open = null;
			await last?.close();
			await registry.destroy();
		},
	};
}
