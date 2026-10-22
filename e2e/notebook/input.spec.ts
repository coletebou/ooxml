import { type Page, expect, test } from '@playwright/test';

// Pointer input the unit tests can only imitate: an eraser swipe faster than the browser reports
// positions.
test.use({ hasTouch: true });

const fresh = (): string =>
	`e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function open(page: Page): Promise<void> {
	await page.goto(`/?storage=${fresh()}&name=Ada`);
	await expect(page.locator('notebook-nav')).toContainText('New Section 1');
}

const command = (page: Page, id: string) =>
	page.locator(`office-ui-ribbon-section [command="${id}"]`).click();

test('erases a stroke that one fast eraser move jumps across', async ({ page }) => {
	await open(page);
	await page.getByRole('tab', { name: 'Draw', exact: true }).click();
	await command(page, 'tool-pen');
	const box = (await page.locator('notebook-page .surface').boundingBox())!;
	await page.mouse.move(box.x + 120, box.y + 120);
	await page.mouse.down();
	for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 120 + i * 12, box.y + 120);
	await page.mouse.up();
	await expect(page.locator('notebook-ink path[data-stroke]')).toHaveCount(1);
	await command(page, 'tool-eraser');
	// Two reported positions, far above and far below the line.
	await page.mouse.move(box.x + 180, box.y + 60);
	await page.mouse.down();
	await page.mouse.move(box.x + 180, box.y + 200, { steps: 1 });
	await page.mouse.up();
	await expect(page.locator('notebook-ink path[data-stroke]')).toHaveCount(0);
});
