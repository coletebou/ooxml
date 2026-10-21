import { readFileSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';
import { WORD_MIME, wordFile } from './support/word-file';

// Each test gets its own IndexedDB database, so runs never see each other's notebooks.
const fresh = (): string =>
	`e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC',
	'base64',
);

async function open(page: Page, storage = fresh(), extra = ''): Promise<string> {
	await page.goto(`/?storage=${storage}&name=Ada${extra}`);
	await expect(page.locator('notebook-nav')).toContainText('New Section 1');
	return storage;
}

async function typeOnCanvas(page: Page, text: string, at = { x: 160, y: 120 }): Promise<void> {
	await page.locator('notebook-page .surface').click({ position: at });
	const editor = page.locator('notebook-text .ProseMirror').last();
	await expect(editor).toBeFocused();
	await page.keyboard.type(text);
}

/** Put the cursor at the end of the first text container (keys for that differ per platform). */
const cursorToEnd = (page: Page) =>
	page
		.locator('notebook-text')
		.first()
		.evaluate((el) => {
			interface EditorViewLike {
				state: {
					doc: unknown;
					selection: { constructor: { atEnd: (doc: unknown) => unknown } };
					tr: { setSelection: (selection: unknown) => unknown };
				};
				dispatch: (tr: unknown) => void;
				focus: () => void;
			}
			const view = (el as unknown as { view: EditorViewLike }).view;
			const Selection = view.state.selection.constructor;
			view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
			view.focus();
		});

const ribbonTab = (page: Page, name: string) =>
	page.getByRole('tab', { name, exact: true }).click();
const command = (page: Page, id: string) =>
	page.locator(`office-ui-ribbon-section [command="${id}"]`).click();

test('writes rich text on a page and keeps it after a reload', async ({ page }) => {
	const storage = await open(page);
	await page.locator('notebook-page input.title').fill('Weekly plan');
	await typeOnCanvas(page, 'Buy milk');
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.press('ControlOrMeta+b');
	await expect(page.locator('notebook-text strong')).toHaveText('Buy milk');
	await cursorToEnd(page);
	await page.keyboard.press('Enter');
	await page.keyboard.type('[] Call the bakery');
	await expect(page.locator('notebook-text .todo-box')).toHaveCount(1);
	// Enter carries the to-do tag to the next line; Enter on that empty line drops it again.
	await page.keyboard.press('Enter');
	await expect(page.locator('notebook-text .todo-box')).toHaveCount(2);
	await page.keyboard.press('Enter');
	await expect(page.locator('notebook-text .todo-box')).toHaveCount(1);
	await page.keyboard.type('* first');
	await expect(page.locator('notebook-text ul li')).toHaveText('first');
	await expect(page.locator('notebook-nav li.page')).toContainText('Weekly plan');
	// Saves are debounced; give the last one time to reach IndexedDB before reloading.
	await page.waitForTimeout(1200);
	await page.reload();
	await expect(page.locator('notebook-page input.title')).toHaveValue('Weekly plan');
	await expect(page.locator('notebook-text strong')).toHaveText('Buy milk');
	await expect(page.locator('notebook-text .todo-box')).toHaveCount(1);
	expect(storage).toBeTruthy();
});

test('organises sections, pages and subpages, and undoes a delete', async ({ page }) => {
	await open(page);
	await page.locator('notebook-nav .sections .add').click();
	const rename = page.locator('notebook-nav input.rename');
	await expect(rename).toBeFocused();
	await rename.fill('Projects');
	await rename.press('Enter');
	await expect(page.locator('notebook-nav li.section.selected')).toContainText('Projects');
	await page.locator('notebook-page input.title').fill('Launch');
	await page.locator('notebook-nav .pages .add').click();
	await page.locator('notebook-page input.title').fill('Details');
	await page.locator('notebook-nav li.page', { hasText: 'Details' }).click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Make subpage' }).click();
	await expect(page.locator('notebook-nav li.page', { hasText: 'Details' })).toHaveAttribute(
		'style',
		/--level:1/u,
	);
	await page.locator('notebook-nav li.page', { hasText: 'Launch' }).focus();
	await page.keyboard.press('Delete');
	await expect(page.locator('notebook-nav li.page')).toHaveCount(0);
	await page.locator('notebook-app .notice .undo').click();
	await expect(page.locator('notebook-nav li.page')).toHaveCount(2);
});

test('searches the notebook and lists to-dos across pages', async ({ page }) => {
	await open(page);
	await page.locator('notebook-page input.title').fill('Groceries');
	await typeOnCanvas(page, '[] Oat milk');
	await page.locator('notebook-nav .pages .add').click();
	await page.locator('notebook-page input.title').fill('Garden');
	await typeOnCanvas(page, 'Plant the tulips');
	await page.locator('notebook-nav office-ui-search input').fill('tulip');
	await expect(page.locator('notebook-nav .hit')).toHaveCount(1);
	await expect(page.locator('notebook-nav .hit mark')).toHaveText('tulip');
	await page.locator('notebook-nav office-ui-search input').fill('');
	await ribbonTab(page, 'View');
	await command(page, 'todos');
	const todos = page.locator('notebook-todos');
	await expect(todos.locator('li')).toHaveText(['Oat milk']);
	await todos.locator('li input[type="checkbox"]').first().check();
	await expect(todos.locator('li.done')).toHaveCount(1);
	await todos.locator('li button.text').click();
	await expect(page.locator('notebook-page input.title')).toHaveValue('Groceries');
	await expect(page.locator('notebook-text .todo-box[data-todo="done"]')).toHaveCount(1);
});

test('draws with the pen, erases the stroke and undoes the erase', async ({ page }) => {
	await open(page);
	await ribbonTab(page, 'Draw');
	await command(page, 'tool-pen');
	const box = (await page.locator('notebook-page .surface').boundingBox())!;
	await page.mouse.move(box.x + 120, box.y + 120);
	await page.mouse.down();
	for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 120 + i * 12, box.y + 120 + i * 6);
	await page.mouse.up();
	await expect(page.locator('notebook-ink path[data-stroke]')).toHaveCount(1);
	await command(page, 'tool-eraser');
	await page.mouse.move(box.x + 170, box.y + 100);
	await page.mouse.down();
	await page.mouse.move(box.x + 180, box.y + 160, { steps: 8 });
	await page.mouse.up();
	await expect(page.locator('notebook-ink path[data-stroke]')).toHaveCount(0);
	await page.locator('office-ui-button[command="undo"]').click();
	await expect(page.locator('notebook-ink path[data-stroke]')).toHaveCount(1);
});

test('inserts a picture and a live Word document, then exports the page to .docx', async ({
	page,
}) => {
	await open(page);
	await page.locator('notebook-page input.title').fill('Report');
	await ribbonTab(page, 'Insert');
	const pictures = page.waitForEvent('filechooser');
	await command(page, 'picture');
	await (await pictures).setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG });
	await expect(page.locator('notebook-page .frame.image img')).toHaveCount(1);
	// Pictures and files are reachable from the keyboard (Tab), then move with the arrows.
	const picture = page.locator('notebook-page .frame.image');
	await expect(picture).toHaveAttribute('tabindex', '0');
	const before = (await picture.boundingBox())!;
	await picture.focus();
	await page.keyboard.press('Shift+ArrowRight');
	await expect.poll(async () => (await picture.boundingBox())!.x).toBeCloseTo(before.x + 10, 0);
	const files = page.waitForEvent('filechooser');
	await command(page, 'file');
	await (
		await files
	).setFiles({
		name: 'report.docx',
		mimeType: WORD_MIME,
		buffer: await wordFile('Embedded report', 'Hello from a Word document inside a notebook page.'),
	});
	const embed = page.locator('notebook-file');
	await expect(embed.locator('.name')).toHaveText('report.docx');
	await expect(embed.locator('docx-editor')).toContainText('Hello from a Word document', {
		timeout: 20_000,
	});
	await typeOnCanvas(page, 'Summary line', { x: 40, y: 20 });
	const download = page.waitForEvent('download');
	await page.locator('notebook-nav .switch').click();
	await page.getByRole('menuitem', { name: 'Export page as a Word document' }).click();
	const file = await download;
	expect(file.suggestedFilename()).toBe('Report.docx');
	const bytes = readFileSync((await file.path())!);
	expect(bytes.subarray(0, 2).toString()).toBe('PK');
});
