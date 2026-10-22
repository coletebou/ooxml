import { expect, test } from '@playwright/test';
import { openDemo } from './helpers';

// An address field turns what it holds into an address a moment after it is left. Left for the
// compose window's Discard, that moment can come once another message is open: what the field
// commits then is the discarded message's, and stays out of the new one.

test('an address still being typed in a discarded message stays out of the next one', async ({
	page,
}) => {
	await openDemo(page);
	// From here on the page's timers run only as the test lets time pass, so the next message is
	// open before the field of the discarded one commits, however long each step takes.
	await page.clock.install();
	await page.getByRole('button', { name: 'New message' }).click();
	const compose = page.locator('mail-compose');
	await compose.locator('mail-recipients input').first().fill('carol@example.com');
	await compose.getByRole('button', { name: 'Discard the draft' }).click();
	await expect(compose).toHaveCount(0);
	await page.getByRole('button', { name: 'New message' }).click();
	await expect(compose.locator('mail-recipients input').first()).toBeFocused();
	await page.clock.runFor(1_000);
	await expect(compose.locator('mail-recipients .chip')).toHaveCount(0);
	type Compose = { compose: { draft: { to: unknown[] } } | null };
	const to = await page
		.locator('mail-app')
		.evaluate(
			(app) =>
				(app as unknown as { client: { getState(): Compose } }).client.getState().compose?.draft.to,
		);
	expect(to).toEqual([]);
});
