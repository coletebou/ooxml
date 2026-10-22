import { expect, test } from '@playwright/test';
import { fileChoosers, openConversation, openDemo, row, selectFolder } from './helpers';

test('write a new message with a suggested recipient and send it', async ({ page }) => {
	await openDemo(page);
	await page.getByRole('button', { name: 'New message' }).click();
	const compose = page.locator('mail-compose');
	await compose.locator('mail-recipients input').first().fill('hana');
	await compose.getByRole('option', { name: /Hana Sato/ }).click();
	await compose.getByPlaceholder('Subject').fill('Cover ideas');
	await compose.locator('.editor').click();
	await page.keyboard.type('Two ideas for the cover are attached.');
	await compose.getByRole('button', { name: 'Send' }).click();
	await expect(page.locator('mail-app .toast')).toContainText('Message sent');
	await selectFolder(page, 'Sent');
	await expect(row(page, 'Cover ideas')).toHaveCount(1);
});

test('reply quotes the original and threads under it', async ({ page }) => {
	await openDemo(page);
	await openConversation(page, 'Contract renewal');
	await page.keyboard.press('r');
	const compose = page.locator('mail-compose');
	await expect(compose.getByPlaceholder('Subject')).toHaveValue('Re: Contract renewal');
	// Threads are per folder, so the conversation in the Inbox is Julia's message (the earlier reply
	// from this account is in Sent): that is what the reply quotes.
	await expect(compose.locator('blockquote')).toContainText('renewal terms are ready');
	await compose.getByRole('button', { name: 'Send' }).click();
	await expect(page.locator('mail-app .toast')).toContainText('Message sent');
});

test('a draft is saved automatically and reopens', async ({ page }) => {
	await openDemo(page);
	// Shortcuts belong to the element, so the focus has to be inside it first.
	await row(page, 'Q3 roadmap review').click();
	await page.keyboard.press('c');
	const compose = page.locator('mail-compose');
	await compose.getByPlaceholder('Subject').fill('Unfinished thought');
	await expect(compose.locator('.status')).toContainText('Draft saved', { timeout: 10_000 });
	await compose.getByRole('button', { name: 'Close and keep the draft' }).click();
	await selectFolder(page, 'Drafts');
	await row(page, 'Unfinished thought').click();
	await expect(page.locator('mail-compose').getByPlaceholder('Subject')).toHaveValue(
		'Unfinished thought',
	);
});

test('a forward shows the picture its message shows and sends it as the same part', async ({
	page,
}) => {
	await openDemo(page);
	await openConversation(page, 'Welcome to the team space');
	await page.locator('mail-reading-pane').getByRole('button', { name: 'Forward' }).last().click();
	const compose = page.locator('mail-compose');
	const logo = compose.locator('.editor img[alt="Northwind logo"]');
	// The logo is an SVG part: it shows from a data: URL, and it really draws.
	await expect(logo).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);
	await expect
		.poll(() => logo.evaluate((img) => (img as HTMLImageElement).naturalWidth))
		.toBeGreaterThan(0);
	// It shows in the text, so it is not listed with the files as well.
	await expect(compose.locator('.files')).toHaveCount(0);
	await compose.locator('mail-recipients input').first().fill('hana@example.com');
	// The top of the editor, its empty first line: away from the picture, which a click selects.
	await compose.locator('.editor').click({ position: { x: 8, y: 8 } });
	await page.keyboard.type('Have a look at the logo.');
	await expect(logo).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);
	await compose.getByRole('button', { name: 'Send' }).click();
	await expect(page.locator('mail-app .toast')).toContainText('Message sent');
	await selectFolder(page, 'Sent');
	await openConversation(page, 'Fwd: Welcome to the team space');
	// The sent copy refers to the picture by cid: and shows it from its own part, so the part is
	// not listed as a file either.
	const frame = page.frameLocator('mail-html-frame iframe');
	await expect(frame.locator('body')).toContainText('Have a look at the logo.');
	await expect(frame.locator('img[alt="Northwind logo"]')).toHaveAttribute(
		'src',
		/^data:image\/svg\+xml;base64,/,
	);
	await expect(page.locator('mail-reading-pane .attachments')).toHaveCount(0);
	type Open = { open: { messages: { message: { html: string | null } | null }[] } | null };
	const sent = await page
		.locator('mail-app')
		.evaluate(
			(app) =>
				(app as unknown as { client: { getState(): Open } }).client.getState().open?.messages.at(-1)
					?.message?.html ?? '',
		);
	expect(sent).toMatch(/<img [^>]*src="cid:logo@northwind"/);
	expect(sent).not.toMatch(/data:|blob:/);
});

test('attach files and import from the keyboard', async ({ page }) => {
	const choosers = fileChoosers(page);
	await openDemo(page);
	await page.getByRole('button', { name: 'New message' }).click();
	const compose = page.locator('mail-compose');
	// Tab reaches Attach files after Send, and Enter or Space opens the file picker.
	await compose.getByRole('button', { name: 'Send' }).focus();
	await page.keyboard.press('Tab');
	await expect(compose.getByRole('button', { name: 'Attach files' })).toBeFocused();
	const picked = choosers.next();
	await page.keyboard.press('Enter');
	await (
		await picked
	).setFiles({
		name: 'notes.txt',
		mimeType: 'text/plain',
		buffer: Buffer.from('Notes'),
	});
	await expect(compose.locator('.files')).toContainText('notes.txt');
	const again = choosers.next();
	await page.keyboard.press(' ');
	expect((await again).isMultiple()).toBe(true);
	await compose.getByRole('button', { name: 'Discard' }).click();
	// The same for .eml files in the list toolbar and vCard files in Contacts.
	const importer = async (name: string) => {
		await page.getByRole('button', { name, exact: true }).focus();
		const chooser = choosers.next();
		await page.keyboard.press('Enter');
		await chooser;
	};
	await importer('Import .eml files');
	await page.locator('mail-app .rail').getByRole('button', { name: 'Contacts' }).click();
	await importer('Import vCard files');
});
