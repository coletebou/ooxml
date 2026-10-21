import { expect, test } from '@playwright/test';
import { openDemo } from './helpers';

test('thousands of messages stay fast: only the rows in view are in the DOM', async ({ page }) => {
	await openDemo(page, '?bulk=5000');
	const rows = page.locator('mail-message-list .row');
	expect(await rows.count()).toBeLessThan(80);
	await expect(page.locator('mail-message-list .more')).toContainText('of 50');
	const viewport = page.locator('mail-message-list .viewport');
	await viewport.evaluate((el) => (el.scrollTop = el.scrollHeight));
	await expect(rows.last()).toBeVisible();
	expect(await rows.count()).toBeLessThan(80);
});
