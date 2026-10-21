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

test('the list still fills its pane after the app is moved in the page', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 400 });
	await openDemo(page, '?bulk=5000');
	// Moved as a host moves it (a tab dragged to another panel): the same element, with its panes.
	await page.evaluate(() => {
		const app = document.querySelector('mail-app')!;
		const panel = document.createElement('div');
		panel.style.cssText = 'position:fixed;inset:0;display:flex;background:white;z-index:1';
		document.body.append(panel);
		app.style.flex = '1';
		panel.append(app);
	});
	await page.setViewportSize({ width: 1280, height: 2000 });
	// The rows reach the foot of the list, drawn for its new height.
	const viewport = page.locator('mail-message-list .viewport');
	await expect
		.poll(() =>
			viewport.evaluate((element) => {
				const foot = Math.min(element.getBoundingClientRect().bottom, innerHeight);
				const rows = [...element.querySelectorAll('.row')];
				return Math.max(...rows.map((row) => row.getBoundingClientRect().bottom)) >= foot - 1;
			}),
		)
		.toBe(true);
});
