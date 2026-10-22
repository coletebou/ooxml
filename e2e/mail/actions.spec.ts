import { expect, test } from '@playwright/test';
import { openConversation, openDemo, row, selectFolder } from './helpers';

test('archive moves a conversation and Undo brings it back', async ({ page }) => {
	await openDemo(page);
	await openConversation(page, 'Chapter 4 edits');
	await page.locator('mail-reading-pane').getByRole('button', { name: 'Archive' }).click();
	await expect(row(page, 'Chapter 4 edits')).toHaveCount(0);
	const toast = page.locator('mail-app .toast').filter({ hasText: 'archived' });
	await expect(toast).toBeVisible();
	await toast.getByRole('button', { name: 'Undo' }).click();
	await expect(row(page, 'Chapter 4 edits')).toHaveCount(1);
});

test('delete moves to Trash, flag and unread toggle from the keyboard', async ({ page }) => {
	await openDemo(page);
	const notice = row(page, 'Office closed on Monday');
	await notice.click();
	await page.keyboard.press('s');
	await expect(notice.locator('.flag')).toHaveClass(/on/);
	await page.keyboard.press('Shift+U');
	await expect(notice).toHaveClass(/unread/);
	await page.keyboard.press('#');
	await expect(notice).toHaveCount(0);
	await selectFolder(page, 'Trash');
	await expect(notice).toHaveCount(1);
});

test('multi-select with the checkboxes and move to a folder', async ({ page }) => {
	await openDemo(page);
	const notes = row(page, 'Interview notes');
	const logos = row(page, 'New logo concepts');
	await notes.locator('input[type="checkbox"]').check();
	await logos.locator('input[type="checkbox"]').check();
	await expect(page.locator('mail-app .selected-count')).toContainText('2 selected');
	await page
		.locator('mail-app .list-toolbar')
		.getByRole('button', { name: 'Mark as unread' })
		.click();
	await expect(notes).toHaveClass(/unread/);
	await page.keyboard.press('e');
	await expect(notes).toHaveCount(0);
	await expect(logos).toHaveCount(0);
	await selectFolder(page, 'Archive');
	await expect(notes).toHaveCount(1);
});
