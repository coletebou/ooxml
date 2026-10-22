import { IDBFactory } from 'fake-indexeddb';
import { loadDocx } from 'ooxml-core/docx';
import { getIcon } from '../icons';
import { TextSelection } from 'prosemirror-state';
import { applyLink, openLinkDialog, runCommand } from './app-actions';
import { notebookMenuAt } from './app-nav';
import { type NotebookApp, type NotebookExportDetail, defineNotebookApp } from './notebook-app';
import type { NotebookText } from './text-container';

async function until(check: () => unknown, ms = 4000): Promise<void> {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw new Error('timed out');
		await new Promise((r) => setTimeout(r, 10));
	}
}

async function mount(): Promise<NotebookApp> {
	defineNotebookApp();
	const app = document.createElement('notebook-app') as NotebookApp;
	app.setAttribute('storage-name', `nb-test-${Math.random().toString(36).slice(2)}`);
	app.userName = 'Ada';
	document.body.append(app);
	await until(() => app.state?.page);
	await app.updateComplete;
	return app;
}

const shadowText = (el: Element | null | undefined): string => el?.shadowRoot?.textContent ?? '';

// happy-dom's ShadowRoot.activeElement throws when the focus is outside that shadow tree (its walk
// up from the focused element runs past the document), where a browser returns null. ProseMirror
// asks every editor's root on each update, so with focus in one text container (or a dialog) the
// others threw. These tests use a getter that answers as a browser does.
const shadowActive = Object.getOwnPropertyDescriptor(ShadowRoot.prototype, 'activeElement')!;
beforeAll(() =>
	Object.defineProperty(ShadowRoot.prototype, 'activeElement', {
		configurable: true,
		get(this: ShadowRoot) {
			try {
				return shadowActive.get!.call(this);
			} catch {
				return null;
			}
		},
	}),
);
afterAll(() => Object.defineProperty(ShadowRoot.prototype, 'activeElement', shadowActive));

describe('<notebook-app>', () => {
	let app: NotebookApp;
	afterEach(() => app?.remove());

	it('opens a first notebook with a section and an untitled page', async () => {
		app = await mount();
		const nav = app.nav()!;
		await nav.updateComplete;
		expect(shadowText(nav)).toContain('New Section 1');
		expect(shadowText(nav)).toContain('Untitled page');
		expect(shadowText(app.page())).toContain('Click anywhere to start typing');
		// Everything the app renders was defined before its first render, so the ribbon sections
		// picked up their groups (a property set before an upgrade is lost) and the glyphs exist.
		const home = app.shadowRoot!.querySelector(
			'[data-ribbon-tab="home"] office-ui-ribbon-section',
		)!;
		expect(home.querySelectorAll('office-ui-ribbon-group')).toHaveLength(3);
		expect(home.querySelector('[command="bold"]')?.hasAttribute('icon-only')).toBe(true);
		expect(getIcon('notebook-todo')).toBeDefined();
	});

	it('places a text container on click, edits it, formats from the ribbon and exports it', async () => {
		app = await mount();
		const page = app.page()!;
		await page.updateComplete;
		const surface = page.shadowRoot!.querySelector<HTMLElement>('.surface')!;
		surface.dispatchEvent(
			new PointerEvent('pointerdown', {
				bubbles: true,
				composed: true,
				button: 0,
				clientX: 120,
				clientY: 160,
			}),
		);
		await until(() => app.state!.containers.length === 1);
		await page.updateComplete;
		const text = page.shadowRoot!.querySelector<NotebookText>('notebook-text')!;
		await until(() => text.view);
		const view = text.view!;
		// y-prosemirror applies collaborators' changes through the view root's createRange.
		expect(typeof (view.root as unknown as { createRange?: unknown }).createRange).toBe('function');
		view.dispatch(view.state.tr.insertText('Hello notebook'));
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
		app.editor = view;
		runCommand(app, 'bold');
		runCommand(app, 'todo');
		app.client!.search('notebook');
		await until(() => app.state!.searchResults.length === 1 && app.state!.todos.length === 1);
		expect(app.state!.todos[0]).toMatchObject({ text: 'Hello notebook', done: false });

		let exported: NotebookExportDetail | null = null;
		app.addEventListener('notebook-export', (e) => {
			e.preventDefault();
			exported = (e as CustomEvent<NotebookExportDetail>).detail;
		});
		app.client!.renamePage(app.state!.pageId, 'Plans');
		runCommand(app, 'tool-pen');
		app.client!.addStroke({
			tool: 'pen',
			color: '#202020',
			width: 2,
			points: [0, 0, 0.5, 40, 40, 0.5],
		});
		await until(() => app.state!.strokes.length === 1);
		const { exportPage } = await import('./app-actions');
		await exportPage(app);
		await until(() => exported);
		const file = exported as unknown as NotebookExportDetail;
		expect(file.fileName).toBe('Plans.docx');
		const doc = await loadDocx(file.bytes);
		const runs = doc.model.blocks.flatMap((b) => ('runs' in b ? b.runs : []));
		expect(runs.find((r) => r.text === 'Hello')?.bold).toBe(true);
		expect(runs.some((r) => r.contentControl?.kind === 'checkbox')).toBe(true);
		// No canvas in this DOM: the ink is reported, not silently lost.
		expect(shadowText(app)).toContain('1 item could not be exported');
	});

	it('links the selection, then edits and removes the whole link around the cursor', async () => {
		app = await mount();
		const page = app.page()!;
		app.client!.addText({ x: 40, y: 40 });
		await until(() => page.shadowRoot!.querySelector<NotebookText>('notebook-text')?.view);
		const view = page.shadowRoot!.querySelector<NotebookText>('notebook-text')!.view!;
		app.editor = view;
		const link = view.state.schema.marks.link!;
		const hrefAt = (pos: number): unknown =>
			link.isInSet(view.state.doc.resolve(pos).marks())?.attrs.href ?? null;
		view.dispatch(view.state.tr.insertText('Read the guide'));
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 10, 15)));
		openLinkDialog(app);
		expect(app.link).toEqual({ href: '', text: 'guide', linked: false });
		await app.updateComplete;
		const dialog = app.shadowRoot!.querySelector('notebook-link-dialog')!;
		await (dialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
		// The text comes from the selection, so it is not typed in.
		expect(dialog.shadowRoot!.querySelector<HTMLInputElement>('input[name="text"]')!.disabled).toBe(
			true,
		);
		applyLink(app, 'https://example.com/guide');
		expect(hrefAt(12)).toBe('https://example.com/guide');

		// With the cursor inside the link, the dialog edits the whole link.
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 12)));
		openLinkDialog(app);
		expect(app.link).toEqual({ href: 'https://example.com/guide', text: 'guide', linked: true });
		applyLink(app, 'https://example.com/other');
		expect([hrefAt(11), hrefAt(14)]).toEqual([
			'https://example.com/other',
			'https://example.com/other',
		]);
		expect(view.state.doc.textContent).toBe('Read the guide');
		applyLink(app, null);
		expect([hrefAt(11), hrefAt(14)]).toEqual([null, null]);

		// An address a viewer may not open (a peer could have stored one) is not offered for editing.
		view.dispatch(view.state.tr.addMark(10, 15, link.create({ href: 'javascript:alert(1)' })));
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 12)));
		openLinkDialog(app);
		expect(app.link).toEqual({ href: '', text: 'guide', linked: true });
		app.link = null;
	});

	it('pastes text below the content and leaves a paste into the title to the title', async () => {
		app = await mount();
		const page = app.page()!;
		const first = app.client!.addText({ x: 40, y: 100 })!;
		await until(() => app.state!.containers.length === 1);
		await page.updateComplete;
		const paste = (target: Element, text: string): void => {
			const clipboardData = new DataTransfer();
			clipboardData.setData('text/plain', text);
			target.dispatchEvent(
				new ClipboardEvent('paste', {
					clipboardData,
					bubbles: true,
					composed: true,
					cancelable: true,
				}),
			);
		};
		paste(page.shadowRoot!.querySelector('input.title')!, 'A title');
		await page.updateComplete;
		expect(app.state!.containers).toHaveLength(1);
		// Nothing was clicked on this page, so the pasted text goes below what is there.
		paste(page.shadowRoot!.querySelector('.scroller')!, 'Pasted');
		await until(() => app.state!.containers.length === 2);
		const pasted = app.state!.containers.find((c) => c.id !== first)!;
		expect([pasted.x, pasted.y]).toEqual([48, 100 + 96 + 24]);
	});

	it('says so when a notebook export fails', async () => {
		app = await mount();
		const failing = vi
			.spyOn(app.client!, 'exportNotebook')
			.mockRejectedValue(new Error('disk full'));
		const { exportNotebook } = await import('./app-actions');
		await exportNotebook(app);
		await app.updateComplete;
		expect(shadowText(app)).toContain('The export failed.');
		failing.mockRestore();
	});

	it('reports an Undo that cannot reopen the notebook the delete came from', async () => {
		app = await mount();
		const first = app.state!.notebookId;
		runCommand(app, 'new-page');
		await until(() => app.state!.pages.length === 2);
		const doomed = app.state!.pageId;
		app.nav()!.dispatchEvent(
			new CustomEvent('nb-delete-item', {
				detail: { kind: 'page', id: doomed },
				bubbles: true,
				composed: true,
			}),
		);
		await until(() => !app.state!.pages.some((p) => p.id === doomed));
		await app.updateComplete;
		const undo = app.shadowRoot!.querySelector<HTMLButtonElement>('.notice .undo')!;
		await app.client!.createNotebook({ name: 'Other' });
		await until(() => app.state!.notebookId !== first && !app.state!.loading);
		const failing = vi.spyOn(app.client!, 'openNotebook').mockRejectedValue(new Error('gone'));
		undo.click();
		await until(() => shadowText(app).includes('The notebook could not be opened.'));
		failing.mockRestore();
	});

	it('shows the formats of the text box being edited and lets go of it on another page', async () => {
		app = await mount();
		const page = app.page()!;
		const item = (text: string) => ({
			type: 'paragraph',
			attrs: { todo: null },
			content: [{ type: 'text', text }],
		});
		app.client!.addText({ x: 40, y: 40 }, [
			{ type: 'bullet_list', content: [{ type: 'list_item', content: [item('listed')] }] },
		]);
		app.client!.addText({ x: 40, y: 400 }, [item('plain')]);
		const texts = () => [...page.shadowRoot!.querySelectorAll<NotebookText>('notebook-text')];
		await until(() => texts().length === 2 && texts().every((t) => t.view));
		const listed = texts().find((t) => t.view!.state.doc.textContent === 'listed')!.view!;
		const plain = texts().find((t) => t.view!.state.doc.textContent === 'plain')!.view!;
		listed.focus();
		await until(() => app.editor === listed);
		expect(app.formats?.list).toBe('bullet');
		// Another text box changing (a collaborator, a ticked box) leaves the ribbon on this one.
		plain.dispatch(plain.state.tr.insertText('!'));
		expect(app.formats?.list).toBe('bullet');
		const before = app.state!.pageId;
		runCommand(app, 'new-page');
		await until(() => app.state!.pageId !== before);
		expect([app.editor, app.formats]).toEqual([null, null]);
	});

	it('drops the previous profile from the screen when the storage changes', async () => {
		app = await mount();
		const before = app.state!.notebookId;
		const old = app.client;
		app.setAttribute('storage-name', `nb-test-${Math.random().toString(36).slice(2)}`);
		// The old client saves its last changes first, then the new one takes over; from then on
		// nothing of the previous profile stays on screen while the next one loads.
		await until(() => app.client !== old);
		expect(app.state?.notebookId ?? '').not.toBe(before);
		await until(() => !!app.state?.page);
		expect(app.state!.notebookId).not.toBe(before);
	});

	it('names new sections in the language set later', async () => {
		app = await mount();
		app.locale = 'de';
		await app.updateComplete;
		runCommand(app, 'new-section');
		await until(() => app.state!.sections.length === 2);
		expect(app.state!.sections.map((s) => s.name)).toContain('Neuer Abschnitt 2');
	});

	it('says the notebooks are saved on the device only when IndexedDB keeps them', async () => {
		vi.stubGlobal('indexedDB', new IDBFactory());
		try {
			app = await mount();
			await app.updateComplete;
			expect(app.shadowRoot!.querySelector('.status .sync')?.textContent).toBe(
				'Saved on this device',
			);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('lets go of the editor when its text box is deleted and keeps KeyTips after a move', async () => {
		app = await mount();
		const page = app.page()!;
		const id = app.client!.addText({ x: 40, y: 40 }, [
			{ type: 'paragraph', attrs: { todo: null }, content: [{ type: 'text', text: 'gone soon' }] },
		]);
		await until(() => page.shadowRoot!.querySelector<NotebookText>('notebook-text')?.view);
		const view = page.shadowRoot!.querySelector<NotebookText>('notebook-text')!.view!;
		view.focus();
		await until(() => app.editor === view);
		app.client!.deleteContainers([id]);
		await until(() => app.state!.containers.length === 0);
		expect([app.editor, app.formats]).toEqual([null, null]);
		// Moved in the DOM: the ribbon's KeyTips (their badge layer in the shadow root) come back.
		const layer = () =>
			[...app.shadowRoot!.children].some((el) => el.matches('div[aria-hidden="true"]'));
		expect(layer()).toBe(true);
		const parent = app.parentElement!;
		app.remove();
		expect(layer()).toBe(false);
		parent.append(app);
		await until(() => !!app.state?.page);
		expect(layer()).toBe(true);
	});

	it('keeps the title field for an input method that confirms with Enter', async () => {
		app = await mount();
		const title = app.page()!.shadowRoot!.querySelector<HTMLInputElement>('input.title')!;
		title.focus();
		title.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
		);
		expect(app.page()!.shadowRoot!.activeElement).toBe(title);
		title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(app.page()!.shadowRoot!.activeElement).not.toBe(title);
	});

	it('shows the navigation pane to rename the notebook when it was hidden', async () => {
		app = await mount();
		app.navOpen = false;
		await app.updateComplete;
		expect(app.nav()).toBeNull();
		notebookMenuAt(app, 10, 10);
		app.menu!.spec.run('rename');
		await until(() => app.nav()?.shadowRoot?.querySelector('input.rename'));
		expect(app.navOpen).toBe(true);
	});

	it('keeps editing when Escape cancels an input method candidate', async () => {
		app = await mount();
		const page = app.page()!;
		app.client!.addText({ x: 40, y: 40 }, [
			{ type: 'paragraph', attrs: { todo: null }, content: [{ type: 'text', text: 'note' }] },
		]);
		await until(() => page.shadowRoot!.querySelector<NotebookText>('notebook-text')?.view);
		const view = page.shadowRoot!.querySelector<NotebookText>('notebook-text')!.view!;
		const escapes: unknown[] = [];
		page.addEventListener('nb-text-escape', (e) => escapes.push(e));
		const escape = (isComposing: boolean) =>
			view.dom.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Escape', isComposing, bubbles: true, composed: true }),
			);
		escape(true);
		expect(escapes).toHaveLength(0);
		escape(false);
		expect(escapes).toHaveLength(1);
		// The same in a section's name field.
		const nav = app.nav()!;
		nav.startRename('section', app.state!.sectionId);
		await nav.updateComplete;
		const field = () => nav.shadowRoot!.querySelector<HTMLInputElement>('input.rename');
		field()!.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }),
		);
		await nav.updateComplete;
		expect(field()).not.toBeNull();
		field()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await nav.updateComplete;
		expect(field()).toBeNull();
	});

	it('keeps a section-tree item in the Tab order when the selected one is folded away', async () => {
		app = await mount();
		const client = app.client!;
		const group = client.createSection({ kind: 'group', name: 'Group' });
		const inner = client.createSection({ name: 'Inner', parentId: group });
		client.selectSection(inner);
		await until(() => app.state!.sectionId === inner);
		const nav = app.nav()!;
		await nav.updateComplete;
		const stops = () => [...nav.shadowRoot!.querySelectorAll('[role="treeitem"][tabindex="0"]')];
		nav.shadowRoot!.querySelector<HTMLElement>(`[data-id="${group}"]`)!.click();
		await nav.updateComplete;
		expect(nav.shadowRoot!.querySelector(`[data-id="${inner}"]`)).toBeNull();
		expect(stops().map((el) => el.getAttribute('data-id'))).toEqual([group]);
	});

	it('deletes a page with Undo in the notice and translates the whole UI', async () => {
		app = await mount();
		const before = app.state!.pages.length;
		runCommand(app, 'new-page');
		await until(() => app.state!.pages.length === before + 1);
		const nav = app.nav()!;
		nav.dispatchEvent(
			new CustomEvent('nb-delete-item', {
				detail: { kind: 'page', id: app.state!.pageId },
				bubbles: true,
				composed: true,
			}),
		);
		await until(() => app.state!.pages.length === before);
		await app.updateComplete;
		const undo = app.shadowRoot!.querySelector<HTMLButtonElement>('.notice .undo')!;
		expect(shadowText(app)).toContain('Page deleted');
		undo.click();
		await until(() => app.state!.pages.length === before + 1);

		// Undo of a delete restores in the notebook it happened in, even after switching away.
		const first = app.state!.notebookId;
		const doomed = app.state!.pageId;
		nav.dispatchEvent(
			new CustomEvent('nb-delete-item', {
				detail: { kind: 'page', id: doomed },
				bubbles: true,
				composed: true,
			}),
		);
		await until(() => !app.state!.pages.some((p) => p.id === doomed));
		await app.updateComplete;
		const undoLater = app.shadowRoot!.querySelector<HTMLButtonElement>('.notice .undo')!;
		await app.client!.createNotebook({ name: 'Other' });
		await until(() => app.state!.notebookId !== first && !app.state!.loading);
		undoLater.click();
		await until(
			() => app.state!.notebookId === first && app.state!.pages.some((p) => p.id === doomed),
		);

		app.locale = 'de';
		await app.updateComplete;
		const ribbon = app.shadowRoot!.querySelector('office-ui-ribbon')!;
		expect(ribbon.querySelector('[data-ribbon-tab="home"]')?.getAttribute('data-label')).toBe(
			'Start',
		);
		// This DOM has no IndexedDB, so the notebooks only last for the session, and the status says so.
		expect(app.shadowRoot!.querySelector('.status .sync')?.textContent).toBe(
			'Nicht auf diesem Gerät gespeichert: Notizbücher bleiben nur, bis dieser Tab geschlossen wird',
		);
	});
});

describe('<notebook-app> on a touch screen', () => {
	let app: NotebookApp;
	afterEach(() => app?.remove());

	it('places a text box on a tap, not on a touch that scrolls the page', async () => {
		app = await mount();
		const page = app.page()!;
		await page.updateComplete;
		const surface = page.shadowRoot!.querySelector<HTMLElement>('.surface')!;
		const at = { bubbles: true, composed: true, button: 0, clientX: 120, clientY: 160 };
		surface.dispatchEvent(new PointerEvent('pointerdown', { ...at, pointerType: 'touch' }));
		await new Promise((r) => setTimeout(r, 20));
		expect(app.state!.containers).toHaveLength(0);
		// The browser took the contact for a scroll: no box, also not on a later click.
		surface.dispatchEvent(new PointerEvent('pointercancel', { ...at, pointerType: 'touch' }));
		surface.dispatchEvent(new MouseEvent('click', at));
		await new Promise((r) => setTimeout(r, 20));
		expect(app.state!.containers).toHaveLength(0);
		// A tap: the box comes with its click.
		surface.dispatchEvent(new PointerEvent('pointerdown', { ...at, pointerType: 'touch' }));
		surface.dispatchEvent(new MouseEvent('click', at));
		await until(() => app.state!.containers.length === 1);
	});
});

describe('<notebook-app> page sizing', () => {
	let app: NotebookApp;
	afterEach(() => {
		app?.remove();
		vi.unstubAllGlobals();
	});

	it('stops watching the text boxes of a page it moved away from', async () => {
		const watched = new Set<Element>();
		vi.stubGlobal(
			'ResizeObserver',
			class {
				observe(el: Element): void {
					watched.add(el);
				}
				unobserve(el: Element): void {
					watched.delete(el);
				}
				disconnect(): void {
					watched.clear();
				}
			},
		);
		app = await mount();
		const page = app.page()!;
		app.client!.addText({ x: 40, y: 40 }, [
			{ type: 'paragraph', attrs: { todo: null }, content: [{ type: 'text', text: 'first' }] },
		]);
		await until(() => page.shadowRoot!.querySelector('.frame.text'));
		await page.updateComplete;
		const frames = () => [...watched].filter((el) => el.matches('.frame.text')).length;
		expect(frames()).toBe(1);
		const before = app.state!.pageId;
		runCommand(app, 'new-page');
		await until(
			() => app.state!.pageId !== before && !page.shadowRoot!.querySelector('.frame.text'),
		);
		await page.updateComplete;
		expect(frames()).toBe(0);
	});
});

describe('<notebook-app> restarts', () => {
	let app: NotebookApp;
	afterEach(() => app?.remove());

	/** Hold the current client's flush until the returned settle function is called. */
	const holdFlush = (target: NotebookApp, fail: boolean) => {
		let settle = (): void => undefined;
		const held = new Promise<void>((resolve, reject) => {
			settle = () => (fail ? reject(new Error('quota exceeded')) : resolve());
		});
		// Handled here too, so a hold no one waits on is not an unhandled rejection.
		held.catch(() => undefined);
		target.client!.flush = () => held;
		return settle;
	};

	it('keeps its client for an equal config object, even when the last save fails', async () => {
		app = await mount();
		const old = app.client!;
		holdFlush(app, true)();
		app.config = { mode: 'local' };
		await app.updateComplete;
		await new Promise((r) => setTimeout(r, 20));
		expect(app.client).toBe(old);
		// Still subscribed: a change shows.
		const before = app.state!.pages.length;
		runCommand(app, 'new-page');
		await until(() => app.state!.pages.length === before + 1);
	});

	it('starts a working client after a failed save when the settings changed and came back', async () => {
		app = await mount();
		const old = app.client!;
		const fail = holdFlush(app, true);
		app.userName = 'Bob';
		await app.updateComplete;
		app.userName = 'Ada';
		await app.updateComplete;
		fail();
		await until(() => app.client !== old && !!app.state?.page);
		const before = app.state!.pages.length;
		runCommand(app, 'new-page');
		await until(() => app.state!.pages.length === before + 1);
	});

	it('shows the notebooks again after switching to another profile and straight back', async () => {
		app = await mount();
		const name = app.getAttribute('storage-name')!;
		const done = holdFlush(app, false);
		app.storageName = `${name}-other`;
		await app.updateComplete;
		expect(app.state).toBeNull();
		app.storageName = name;
		await app.updateComplete;
		done();
		await until(() => !!app.state?.page);
	});

	it('hands no host the old profile client while that one saves its last changes', async () => {
		app = await mount();
		const old = app.client!;
		const done = holdFlush(app, false);
		app.storageName = `${app.getAttribute('storage-name')}-other`;
		await app.updateComplete;
		expect(app.client).toBeNull();
		done();
		await until(() => !!app.client && app.client !== old && !!app.state?.page);
	});

	it('closes the menus and dialogs of a profile it switches away from at once', async () => {
		app = await mount();
		holdFlush(app, false);
		notebookMenuAt(app, 10, 10);
		app.link = { href: 'https://kept.example/', text: 'private words', linked: true };
		await app.updateComplete;
		expect(app.menu).not.toBeNull();
		app.storageName = `${app.getAttribute('storage-name')}-other`;
		await app.updateComplete;
		expect([app.state, app.menu, app.link]).toEqual([null, null, null]);
	});

	it('does not show a profile it switched away from when that one finishes loading', async () => {
		defineNotebookApp();
		app = document.createElement('notebook-app') as NotebookApp;
		const name = `nb-test-${Math.random().toString(36).slice(2)}`;
		app.setAttribute('storage-name', name);
		app.userName = 'Ada';
		const ready: string[] = [];
		app.addEventListener('notebook-ready', () => ready.push(app.storageName));
		document.body.append(app);
		await app.updateComplete;
		const done = holdFlush(app, false);
		app.storageName = `${name}-other`;
		await app.updateComplete;
		// The first client finishes loading while its last save is still pending.
		await new Promise((r) => setTimeout(r, 700));
		expect(app.state).toBeNull();
		expect(ready).toEqual([]);
		done();
		await until(() => !!app.state?.page);
		expect(ready).toEqual([`${name}-other`]);
	});
});
