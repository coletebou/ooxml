// Shared steps of the OpenMail browser tests. They run against the React demo on the in-memory demo
// mailbox, so no server is needed. Playwright's CSS and text locators pierce the open shadow roots.
import { expect, type FileChooser, type Page } from '@playwright/test';

/**
 * The file choosers `page` opens, in turn, from one listener kept for the page's whole life. Each
 * `page.waitForEvent('filechooser')` turns Playwright's interception of the choosers on, and off
 * once it has one; a chooser that opens while it is still being turned on is never reported (about
 * one in ten in Chrome 156, measured against one listener kept: none of 240), so a test that
 * waited for each in turn failed now and then without any fault of the app. Call it before the
 * first chooser opens; `next` rejects when none opens within `timeout`.
 */
export function fileChoosers(page: Page): { next(timeout?: number): Promise<FileChooser> } {
	const opened: FileChooser[] = [];
	const waiting: ((chooser: FileChooser) => void)[] = [];
	page.on('filechooser', (chooser) => {
		const take = waiting.shift();
		if (take) take(chooser);
		else opened.push(chooser);
	});
	return {
		next(timeout = 10_000) {
			const ready = opened.shift();
			if (ready) return Promise.resolve(ready);
			return new Promise((resolve, reject) => {
				const take = (chooser: FileChooser): void => {
					clearTimeout(timer);
					resolve(chooser);
				};
				const timer = setTimeout(() => {
					waiting.splice(waiting.indexOf(take), 1);
					reject(new Error(`No file chooser opened within ${timeout} ms.`));
				}, timeout);
				waiting.push(take);
			});
		},
	};
}

export async function openDemo(page: Page, query = ''): Promise<void> {
	await page.goto(`/${query}`);
	await expect(page.locator('mail-app')).toBeVisible({ timeout: 30_000 });
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

let imported = 0;

/**
 * The header of a message from Ada to you with its own Message-ID, as the lines of an `.eml` up
 * to the blank line that ends it.
 */
export const emlHeader = (subject: string, contentType: string): string[] => [
	'From: Ada <ada@example.com>',
	'To: You <you@example.com>',
	`Subject: ${subject}`,
	`Message-ID: <imported-${++imported}-${Date.now()}@example.com>`,
	`Date: ${new Date().toUTCString()}`,
	'MIME-Version: 1.0',
	`Content-Type: ${contentType}`,
	'',
];

/** The import button's file input, which reads `.eml` files. */
const emlInput = (page: Page) =>
	page.locator('mail-app input[type="file"][accept=".eml,message/rfc822"]');

/**
 * Import HTML messages from Ada as `.eml` files, as a person does with the import button; each
 * becomes a conversation of its own, in the Inbox.
 */
export async function importHtmlMail(
	page: Page,
	messages: readonly { subject: string; html: string }[],
): Promise<void> {
	await emlInput(page).setInputFiles(
		messages.map(({ subject, html }, i) => ({
			name: `message-${i + 1}.eml`,
			mimeType: 'message/rfc822',
			buffer: Buffer.from(
				[...emlHeader(subject, 'text/html; charset=utf-8'), html, ''].join('\r\n'),
			),
		})),
	);
	for (const { subject } of messages) await expect(row(page, subject)).toHaveCount(1);
}

/** Import one message written out as the lines of an `.eml` (`emlHeader` and a body). */
export async function importEml(
	page: Page,
	subject: string,
	lines: readonly string[],
): Promise<void> {
	await emlInput(page).setInputFiles({
		name: 'message.eml',
		mimeType: 'message/rfc822',
		buffer: Buffer.from(lines.join('\r\n')),
	});
	await expect(row(page, subject)).toHaveCount(1);
}
