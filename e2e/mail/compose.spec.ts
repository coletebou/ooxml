import { expect, test } from '@playwright/test';
import { openConversation, openDemo, row, selectFolder } from './helpers';

test('write a new message with a suggested recipient and send it', async ({ page }) => {
	await openDemo(page);
	await page.getByRole('button', { name: 'New message' }).click();
	const compose = page.locator('mail-compose');
	await compose.locator('mail-recipients input').first().fill('hana');
	await compose.getByRole('option', { name: /Hana Sato/ }).click();
	await compose.getByPlaceholder('Subject').fill('Cover ideas');
	await compose.locator('.editor').click();
	await page.keyboard.type('Two ideas for the cover are attached.');
	await compose.getByRole('button', { name: 'Send' }).click();
	await expect(page.locator('mail-app .toast')).toContainText('Message sent');
	await selectFolder(page, 'Sent');
	await expect(row(page, 'Cover ideas')).toHaveCount(1);
});

test('reply quotes the original and threads under it', async ({ page }) => {
	await openDemo(page);
	await openConversation(page, 'Contract renewal');
	await page.keyboard.press('r');
	const compose = page.locator('mail-compose');
	await expect(compose.getByPlaceholder('Subject')).toHaveValue('Re: Contract renewal');
	await expect(compose.locator('blockquote')).toContainText('3 pm');
	await compose.getByRole('button', { name: 'Send' }).click();
	await expect(page.locator('mail-app .toast')).toContainText('Message sent');
});

test('a draft is saved automatically and reopens', async ({ page }) => {
	await openDemo(page);
	await page.keyboard.press('c');
	const compose = page.locator('mail-compose');
	await compose.getByPlaceholder('Subject').fill('Unfinished thought');
	await expect(compose.locator('.status')).toContainText('Draft saved', { timeout: 10_000 });
	await compose.getByRole('button', { name: 'Close and keep the draft' }).click();
	await selectFolder(page, 'Drafts');
	await row(page, 'Unfinished thought').click();
	await expect(page.locator('mail-compose').getByPlaceholder('Subject')).toHaveValue(
		'Unfinished thought',
	);
});
