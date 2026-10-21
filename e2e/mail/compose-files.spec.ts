import { expect, test, type Page } from '@playwright/test';
import { openConversation, openDemo, row, selectFolder } from './helpers';

// A file picked in the compose window joins the draft once it is read. What asks for the draft
// meanwhile (Ctrl+Enter, the host) waits for it, and acts on that draft only: one thrown away
// before the file is read hands nothing over to the draft started after it.

/** Hold the reads of the files picked from now on, as for a large file; the call returned ends it. */
async function holdReads(page: Page): Promise<() => Promise<void>> {
	await page.evaluate(() => {
		const read = Blob.prototype.arrayBuffer;
		let release = (): void => {};
		const held = new Promise<void>((resolve) => (release = resolve));
		Object.assign(window, { releaseReads: release });
		Blob.prototype.arrayBuffer = function (this: Blob) {
			return held.then(() => read.call(this));
		};
	});
	return () => page.evaluate(() => (window as unknown as { releaseReads(): void }).releaseReads());
}

/** Start a message to `to` about `subject`, with a file picked whose read is held. */
async function writeWithFile(page: Page, to: string, subject: string) {
	await page.getByRole('button', { name: 'New message' }).click();
	const compose = page.locator('mail-compose');
	await compose.locator('mail-recipients input').first().fill(to);
	await compose.getByPlaceholder('Subject').fill(subject);
	const release = await holdReads(page);
	await compose.locator('input.file').setInputFiles({
		name: 'notes.txt',
		mimeType: 'text/plain',
		buffer: Buffer.from('Notes from the meeting.'),
	});
	// Send is off while the file is read.
	await expect(compose.getByRole('button', { name: 'Send' })).toBeDisabled();
	return release;
}

test('Ctrl+Enter while a picked file is still being read sends the message with it', async ({
	page,
}) => {
	await openDemo(page);
	const release = await writeWithFile(page, 'hana@example.com', 'Meeting notes');
	await page.locator('mail-compose').getByPlaceholder('Subject').press('ControlOrMeta+Enter');
	await release();
	await expect(page.locator('mail-app .toast')).toContainText('Message sent');
	await selectFolder(page, 'Sent');
	await openConversation(page, 'Meeting notes');
	await expect(page.locator('mail-reading-pane .attachments')).toContainText('notes.txt');
});

test('a send asked while a file is read leaves alone the draft started after its own was discarded', async ({
	page,
}) => {
	await openDemo(page);
	const release = await writeWithFile(page, 'hana@example.com', 'First thoughts');
	// The host asks to send; before the file is read, the draft is thrown away and another started.
	await page.locator('mail-app').evaluate((app) => {
		const { client } = app as unknown as { client: { send(): Promise<boolean> } };
		Object.assign(window, { sending: client.send() });
	});
	const compose = page.locator('mail-compose');
	await compose.getByRole('button', { name: 'Discard the draft' }).click();
	await page.getByRole('button', { name: 'New message' }).click();
	await compose.locator('mail-recipients input').first().fill('bob@example.com');
	await compose.getByPlaceholder('Subject').fill('Second thoughts');
	await release();
	const sent = await page.evaluate(
		() => (window as unknown as { sending: Promise<boolean> }).sending,
	);
	expect(sent).toBe(false);
	await expect(compose.getByPlaceholder('Subject')).toHaveValue('Second thoughts');
	await selectFolder(page, 'Sent');
	await expect(row(page, /thoughts/)).toHaveCount(0);
});
