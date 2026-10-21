import { type Page, expect, test } from '@playwright/test';

/** The text of the first text container's document (collaborators' caret labels are not text). */
const docText = (page: Page): Promise<string> =>
	page
		.locator('notebook-text')
		.first()
		.evaluate(
			(el) =>
				(el as unknown as { view: { state: { doc: { textContent: string } } } }).view.state.doc
					.textContent,
		);

// Two tabs of one browser share a notebook over BroadcastChannel (local mode, no server): edits
// merge in real time and each tab sees the other person, on the page and in the text.
test('two tabs edit one notebook in real time with presence', async ({ context }) => {
	const storage = `e2e-collab-${Date.now().toString(36)}`;
	const ada = await context.newPage();
	await ada.goto(`/?storage=${storage}&name=Ada`);
	await expect(ada.locator('notebook-nav')).toContainText('New Section 1');
	await ada.waitForTimeout(800);

	const bob = await context.newPage();
	await bob.goto(`/?storage=${storage}&name=Bob`);
	await expect(bob.locator('notebook-nav')).toContainText('New Section 1');
	await expect(ada.locator('notebook-app .status')).toContainText('1 other person here');
	await expect(bob.locator('notebook-app .status')).toContainText('1 other person here');

	await ada.locator('notebook-page input.title').fill('Shared agenda');
	await expect(bob.locator('notebook-page input.title')).toHaveValue('Shared agenda');

	await ada.locator('notebook-page .surface').click({ position: { x: 160, y: 120 } });
	await expect(ada.locator('notebook-text .ProseMirror')).toBeFocused();
	await ada.keyboard.type('Hello from Ada');
	await expect.poll(() => docText(bob)).toBe('Hello from Ada');
	// Bob sees where Ada is: her container carries her name.
	await expect(bob.locator('notebook-page .peer-tag')).toHaveText('Ada is here');

	// Bob types into the same container; the text merges in both tabs.
	// Put Bob's cursor at the end of the text (keyboard selection shortcuts differ per platform).
	await bob
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
	await bob.keyboard.type(' and Bob');
	await expect.poll(() => docText(ada)).toBe('Hello from Ada and Bob');
	// Ada sees Bob's caret, labelled with his name, in the shared text.
	await expect(ada.locator('notebook-text .remote-label')).toHaveText('Bob');

	// A section Bob adds appears for Ada.
	await bob.locator('notebook-nav .sections .add').click();
	await bob.keyboard.press('Enter');
	await expect(ada.locator('notebook-nav li.section')).toHaveCount(2);
});
