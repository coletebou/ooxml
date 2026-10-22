import { expect, test } from '@playwright/test';
import { openConversation, openDemo, row } from './helpers';

// The shortcuts belong to the element, so they stop once the focus falls out of it: whatever an
// action takes away (a closed conversation, a sent message, a drawer) must leave the focus inside.

test('archiving from the reading pane opens the next conversation with Archive still focused', async ({
	page,
}) => {
	await openDemo(page);
	await openConversation(page, 'Chapter 4 edits');
	const subject = page.locator('mail-reading-pane h2');
	const archive = page.locator('mail-reading-pane').getByRole('button', { name: 'Archive' });
	await archive.focus();
	await page.keyboard.press('Enter');
	await expect(row(page, 'Chapter 4 edits')).toHaveCount(0);
	await expect(subject).toBeVisible();
	await expect(subject).not.toHaveText('Chapter 4 edits');
	await expect(archive).toBeFocused();
	// The keys still reach the app: e archives the conversation open now.
	const next = (await subject.textContent()) ?? '';
	await page.keyboard.press('e');
	await expect(subject).not.toHaveText(next);
	await expect(archive).toBeFocused();
});

test('Escape closes the conversation and the list takes the focus, so Enter opens it again', async ({
	page,
}) => {
	await openDemo(page);
	await openConversation(page, 'Chapter 4 edits');
	await page.locator('mail-reading-pane').getByRole('button', { name: 'Mark as unread' }).focus();
	await page.keyboard.press('Escape');
	await expect(page.locator('mail-reading-pane .placeholder')).toBeVisible();
	await expect(page.locator('mail-message-list .viewport')).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.locator('mail-reading-pane h2')).toContainText('Chapter 4 edits');
});

test('closing the compose window gives the focus back to the list that opened it', async ({
	page,
}) => {
	await openDemo(page);
	await row(page, 'Chapter 4 edits').click();
	const list = page.locator('mail-message-list .viewport');
	await expect(list).toBeFocused();
	await page.keyboard.press('c');
	const compose = page.locator('mail-compose');
	await expect(compose).toBeVisible();
	await expect(list).not.toBeFocused();
	await page.keyboard.press('Escape');
	await expect(compose).toHaveCount(0);
	await expect(list).toBeFocused();
	await page.keyboard.press('?');
	await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
});

test('a narrow app keeps the focus when its folder drawer and its reading view close', async ({
	page,
}) => {
	await page.setViewportSize({ width: 480, height: 800 });
	await openDemo(page);
	const folders = page.locator('mail-folder-pane');
	const list = page.locator('mail-message-list .viewport');
	await page.locator('mail-app .folders-toggle').click();
	await expect(folders).toBeVisible();
	// Picking a folder closes the drawer the focus was in: the list of that folder takes it.
	await folders.locator('.folder', { hasText: 'Inbox' }).click();
	await expect(folders).toBeHidden();
	await expect(list).toBeFocused();
	// Reading hides the list; Escape shows it again, with the focus on it.
	await page.keyboard.press('j');
	await page.keyboard.press('Enter');
	const back = page.locator('mail-reading-pane').getByRole('button', { name: 'Back' });
	await expect(back).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(list).toBeVisible();
	await expect(list).toBeFocused();
});
