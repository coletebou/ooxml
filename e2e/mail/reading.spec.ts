import { expect, test } from '@playwright/test';
import { openConversation, openDemo } from './helpers';

test('a conversation opens oldest first with the newest message expanded', async ({ page }) => {
	await openDemo(page);
	await openConversation(page, 'Q3 roadmap review');
	const messages = page.locator('mail-reading-pane article.message');
	await expect(messages).toHaveCount(4);
	await expect(messages.last()).toHaveClass(/open/);
	await expect(messages.last()).toContainText('update the tickets');
	// Opening marks it read.
	await expect(page.locator('mail-message-list .row.open')).not.toHaveClass(/unread/);
});

test('HTML mail runs no script and loads no remote image until allowed', async ({ page }) => {
	await openDemo(page);
	const title = await page.title();
	await openConversation(page, 'This week: offline-first apps');
	const frame = page.frameLocator('mail-html-frame iframe');
	await expect(frame.locator('h1')).toHaveText('Example Weekly');
	// The script tag is gone and never ran.
	await expect(frame.locator('script')).toHaveCount(0);
	expect(await page.title()).toBe(title);
	// The remote banner and tracking pixel are blocked and counted.
	const banner = page.locator('mail-reading-pane .remote');
	await expect(banner).toContainText('Blocked 2 remote images');
	await expect(frame.locator('img[src*="example.com"]')).toHaveCount(0);
	// Links open in a new tab without an opener.
	await expect(frame.locator('a').first()).toHaveAttribute('rel', 'noopener noreferrer');
	await expect(frame.locator('a').first()).toHaveAttribute('target', '_blank');
	await banner.getByRole('button', { name: 'Show images' }).click();
	await expect(banner).toHaveCount(0);
	await expect(frame.locator('img[src="https://images.example.com/banner.png"]')).toHaveCount(1);
});

test('an inline cid image shows from the message itself', async ({ page }) => {
	await openDemo(page);
	await openConversation(page, 'Welcome to the team space');
	const frame = page.frameLocator('mail-html-frame iframe');
	await expect(frame.locator('img[alt="Northwind logo"]')).toHaveAttribute('src', /^blob:/);
	await expect(page.locator('mail-reading-pane .remote')).toHaveCount(0);
});
