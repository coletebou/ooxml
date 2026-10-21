import { loadDocx } from 'ooxml-core/docx';
import { getIcon } from '../icons';
import { TextSelection } from 'prosemirror-state';
import { runCommand } from './app-actions';
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
		const home = app.shadowRoot!.querySelector('[data-ribbon-tab="home"] office-ui-ribbon-section')!;
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
