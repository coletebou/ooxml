import { expect, test } from '@playwright/test';
import { currentFolder, openDemo } from './helpers';

test('the app speaks the chosen language', async ({ page }) => {
	await openDemo(page, '?locale=de');
	await expect(currentFolder(page)).toContainText('Posteingang');
	await expect(page.getByRole('button', { name: 'Neue Nachricht' })).toBeVisible();
});
