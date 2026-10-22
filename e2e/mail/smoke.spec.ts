import { expect, test } from '@playwright/test';
import { currentFolder, openDemo, row } from './helpers';

test('the demo mounts <mail-app> on the demo mailbox', async ({ page }) => {
	await openDemo(page);
	await expect(page).toHaveTitle(/OpenMail/);
	await expect(currentFolder(page)).toContainText('Inbox');
	await expect(row(page, 'Q3 roadmap review')).toHaveCount(1);
	// The newest conversation is first and the unread ones are marked.
	await expect(page.locator('mail-message-list .row').first()).toContainText(
		'This week: offline-first apps',
	);
	await expect(page.locator('mail-message-list .row.unread').first()).toBeVisible();
});
