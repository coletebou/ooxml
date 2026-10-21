import { expect, test } from '@playwright/test';
import { importHtmlMail, openConversation, openDemo } from './helpers';

test('a message frame is as tall as its message, whatever it showed before or its window', async ({
	page,
}) => {
	await openDemo(page);
	await importHtmlMail(page, [
		{ subject: 'Tall frame', html: '<div style="height:2400px">Tall</div>' },
		{ subject: 'Short frame', html: '<p>Short.</p>' },
		{
			subject: 'Window frame',
			html: '<style>body{height:100vh}</style><p>As tall as its window.</p>',
		},
	]);
	const frame = page.locator('mail-reading-pane mail-html-frame iframe').first();
	const height = async (): Promise<number> => (await frame.boundingBox())?.height ?? 0;
	await openConversation(page, 'Tall frame');
	await expect.poll(height).toBeGreaterThan(2400);
	// Measured again (its width changes), the frame keeps the reading pane where it was scrolled to.
	const scrolled = (to?: number) =>
		page.evaluate((top) => {
			const pane = document
				.querySelector('mail-app')
				?.shadowRoot?.querySelector('mail-reading-pane');
			let node: Element | null | undefined = pane?.shadowRoot?.querySelector('mail-html-frame');
			while (node) {
				const parent: Element | null =
					node.parentElement ?? ((node.getRootNode() as ShadowRoot).host || null);
				if (parent && /auto|scroll/.test(getComputedStyle(parent).overflowY)) {
					if (top !== undefined) parent.scrollTop = top;
					return parent.scrollTop;
				}
				node = parent;
			}
			return null;
		}, to);
	const bottom = await scrolled(100_000);
	expect(bottom).toBeGreaterThan(1000);
	const width = async (): Promise<number> => (await frame.boundingBox())?.width ?? 0;
	const wide = await width();
	await page.setViewportSize({ width: 1240, height: 720 });
	await expect.poll(width).toBeLessThan(wide);
	await page.waitForTimeout(300);
	expect(await scrolled()).toBe(bottom);
	await openConversation(page, 'Short frame');
	await expect.poll(height).toBeLessThan(120);
	// Both bodies are kept now, so each opens straight into the frame the other one left.
	await openConversation(page, 'Tall frame');
	await expect.poll(height).toBeGreaterThan(2400);
	await openConversation(page, 'Short frame');
	await expect.poll(height).toBeLessThan(120);
	// A page as tall as its window does not grow the frame each time it is measured.
	await openConversation(page, 'Window frame');
	await expect.poll(height).toBeLessThan(120);
	const settled = await height();
	await page.waitForTimeout(1000);
	expect(await height()).toBe(settled);
});

test('a message frame grows and shrinks with a details element the reader opens and closes', async ({
	page,
}) => {
	await openDemo(page);
	await importHtmlMail(page, [
		{
			subject: 'Details frame',
			html: '<details><summary>More</summary><div style="height:600px">What it holds</div></details>',
		},
	]);
	await openConversation(page, 'Details frame');
	const frame = page.locator('mail-reading-pane mail-html-frame iframe').first();
	const height = async (): Promise<number> => (await frame.boundingBox())?.height ?? 0;
	await expect.poll(height).toBeLessThan(120);
	const summary = page.frameLocator('mail-reading-pane mail-html-frame iframe').locator('summary');
	await summary.click();
	await expect.poll(height).toBeGreaterThan(600);
	await summary.click();
	await expect.poll(height).toBeLessThan(120);
});

test('the shortcuts work with the focus in an HTML message, which keeps its own keys', async ({
	page,
}) => {
	await openDemo(page);
	await openConversation(page, 'This week: offline-first apps');
	const frame = page.frameLocator('mail-reading-pane mail-html-frame iframe');
	await frame.locator('h1').click();
	// The focus is in the message's own document now.
	expect(await frame.locator('body').evaluate((body) => body.ownerDocument.hasFocus())).toBe(true);
	// Its own keys: Ctrl/Cmd+A selects its text, not every conversation, and the arrows scroll it
	// rather than open the next conversation.
	await page.keyboard.press('ControlOrMeta+a');
	expect(
		await frame.locator('body').evaluate((body) => body.ownerDocument.getSelection()?.toString()),
	).toContain('Example Weekly');
	await expect(page.locator('mail-app .selected-count')).toHaveCount(0);
	await page.keyboard.press('ArrowDown');
	await expect(page.locator('mail-reading-pane h2')).toHaveText('This week: offline-first apps');
	// A shortcut: r answers the open message.
	await page.keyboard.press('r');
	await expect(page.locator('mail-compose').getByPlaceholder('Subject')).toHaveValue(
		'Re: This week: offline-first apps',
	);
});
