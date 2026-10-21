import { loadDocx } from 'ooxml-core/docx';
import { getIcon } from '../icons';
import { TextSelection } from 'prosemirror-state';
import { applyLink, openLinkDialog, runCommand } from './app-actions';
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
		expect(app.shadowRoot!.querySelector('.status .sync')?.textContent).toBe(
			'Auf diesem Gerät gespeichert',
		);
	});
});
