import { expect, test } from '@playwright/test';
import { openDemo } from './helpers';

test('the app speaks the chosen language', async ({ page }) => {
	await openDemo(page, '?locale=de');
	await expect(page.locator('mail-folder-pane .folder[aria-current="page"]')).toContainText(
		'Posteingang',
	);
	await expect(page.getByRole('button', { name: 'Neue Nachricht' })).toBeVisible();
});
