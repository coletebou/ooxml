// Shared steps of the OpenMail browser tests. They run against the React demo on the in-memory demo
// mailbox, so no server is needed. Playwright's CSS and text locators pierce the open shadow roots.
import { expect, type Page } from '@playwright/test';

export async function openDemo(page: Page, query = ''): Promise<void> {
	await page.goto(`/${query}`);
	await expect(page.locator('mail-app')).toBeVisible();
	// The demo mailbox is ready once the first conversations are listed.
	await expect(page.locator('mail-message-list .row').first()).toBeVisible({ timeout: 30_000 });
}

/** The list row whose subject contains `subject`. */
export const row = (page: Page, subject: string | RegExp) =>
	page
		.locator('mail-message-list .row')
		.filter({ has: page.locator('.subject', { hasText: subject }) });

export async function openConversation(page: Page, subject: string | RegExp): Promise<void> {
	await row(page, subject).first().click();
	await expect(page.locator('mail-reading-pane h2')).toContainText(subject);
}

/** The selected folder in the folder pane. */
export const currentFolder = (page: Page) =>
	page.locator('mail-folder-pane .folder[aria-current="page"]');

export async function selectFolder(page: Page, name: string): Promise<void> {
	await page.locator('mail-folder-pane .folder', { hasText: name }).click();
	await expect(currentFolder(page)).toContainText(name);
}
