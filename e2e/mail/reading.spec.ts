import { expect, test } from '@playwright/test';
import { importHtmlMail, openConversation, openDemo } from './helpers';

/** A one-pixel PNG, for the pictures image maps are drawn over. */
const PIXEL =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('a conversation opens oldest first with the newest message expanded', async ({ page }) => {
	await openDemo(page);
	await openConversation(page, 'Q3 roadmap review');
	const messages = page.locator('mail-reading-pane article.message');
	// Threads are per folder: the Inbox holds the request and two replies; the reply sent from this
	// account is in Sent.
	await expect(messages).toHaveCount(3);
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
	// The logo is an SVG: it shows from a data: URL, never from a blob: URL of the app's own origin.
	await expect(frame.locator('img[alt="Northwind logo"]')).toHaveAttribute(
		'src',
		/^data:image\/svg\+xml;base64,/,
	);
	await expect(page.locator('mail-reading-pane .remote')).toHaveCount(0);
});

test('an image map area opens its page in a new tab without an opener, as a link does', async ({
	page,
	context,
}) => {
	await context.route('https://elsewhere.example/**', (route) =>
		route.fulfill({ contentType: 'text/html', body: '<p>Elsewhere</p>' }),
	);
	await openDemo(page);
	// One area asks for the opener, the other for the message's own frame.
	await importHtmlMail(page, [
		{
			subject: 'Image map',
			html: `<img usemap="#m" width="200" src="data:image/png;base64,${PIXEL}" alt="Map"><map name="m"><area shape="rect" coords="0,0,99,9999" href="https://elsewhere.example/a" rel="opener" target="_blank"><area shape="rect" coords="100,0,9999,9999" href="https://elsewhere.example/b" target="_self"></map>`,
		},
	]);
	await openConversation(page, 'Image map');
	const frame = page.frameLocator('mail-html-frame iframe');
	for (const x of [50, 150]) {
		const [tab] = await Promise.all([
			context.waitForEvent('page'),
			frame.locator('img').click({ position: { x, y: 20 } }),
		]);
		await tab.waitForLoadState();
		await expect(tab.locator('p')).toHaveText('Elsewhere');
		expect(await tab.evaluate(() => window.opener === null), `x ${x}`).toBe(true);
		await tab.close();
	}
	// The message is still shown where it was.
	await expect(frame.locator('img[alt="Map"]')).toBeVisible();
});

test('a mailto: area of an image map starts a message to its address, as a link does', async ({
	page,
	context,
}) => {
	await openDemo(page);
	await importHtmlMail(page, [
		{
			subject: 'Mail map',
			html: `<img usemap="#m" width="200" src="data:image/png;base64,${PIXEL}" alt="Map"><map name="m"><area shape="rect" coords="0,0,9999,9999" href="mailto:bob@example.com?subject=Hello%20Bob"></map>`,
		},
	]);
	await openConversation(page, 'Mail map');
	const tabs: unknown[] = [];
	context.on('page', (tab) => tabs.push(tab));
	await page
		.frameLocator('mail-html-frame iframe')
		.locator('img')
		.click({ position: { x: 50, y: 20 } });
	await expect(page.locator('mail-compose').getByPlaceholder('Subject')).toHaveValue('Hello Bob');
	type Compose = { compose: { draft: { to: unknown[] } } | null };
	const to = await page
		.locator('mail-app')
		.evaluate(
			(app) =>
				(app as unknown as { client: { getState(): Compose } }).client.getState().compose?.draft.to,
		);
	expect(to).toEqual([{ name: '', email: 'bob@example.com' }]);
	// Compose opened in the app: no tab was opened for the address.
	expect(tabs).toEqual([]);
});
