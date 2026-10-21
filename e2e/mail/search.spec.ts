import { expect, test } from '@playwright/test';
import { openDemo, row } from './helpers';

test('search by sender and subject words, then clear', async ({ page }) => {
	await openDemo(page);
	const search = page.getByRole('searchbox', { name: 'Search mail' });
	await search.fill('from:ben invoice');
	await search.press('Enter');
	await expect(row(page, 'Invoice 2026-118')).toHaveCount(1);
	await expect(page.locator('mail-message-list .row')).toHaveCount(1);
	await search.fill('');
	await search.press('Enter');
	await expect(row(page, 'Q3 roadmap review')).toHaveCount(1);
});
