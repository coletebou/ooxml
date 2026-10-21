import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { openConversation, openDemo, row } from './helpers';

async function openCalendar(page: Page): Promise<void> {
	await page
		.locator('mail-app .rail')
		.getByRole('button', { name: 'Calendar', exact: true })
		.click();
	await expect(page.locator('mail-calendar-grid')).toBeVisible();
}

const grid = (page: Page) => page.locator('mail-calendar-grid');

/** Today's date in the browser's zone as an iCalendar date (`20261021`). */
const today = (page: Page): Promise<string> =>
	page.evaluate(() => {
		const d = new Date();
		return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
	});

test('the calendar shows the demo events by week, day and month', async ({ page }) => {
	await openDemo(page);
	await openCalendar(page);
	await expect(grid(page).getByRole('button', { name: 'Week', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true',
	);
	await expect(grid(page).getByText('Roadmap review')).toBeVisible();
	await grid(page).getByRole('button', { name: 'Day', exact: true }).click();
	await expect(grid(page).getByText('Stand-up')).toBeVisible();
	await grid(page).getByRole('button', { name: 'Month', exact: true }).click();
	await expect(grid(page).getByText('Lisbon trip').first()).toBeVisible();
});

test('a new event is saved from the dialog, and mail shortcuts stay with the mail view', async ({
	page,
}) => {
	await openDemo(page);
	// An open conversation is what archive and delete would act on.
	await openConversation(page, 'Q3 roadmap review');
	await openCalendar(page);
	await grid(page).getByRole('button', { name: 'New event' }).click();
	const dialog = page.getByRole('dialog', { name: 'New event' });
	await expect(dialog).toBeVisible();
	await dialog.getByLabel('Title').fill('Design review');
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(dialog).toHaveCount(0);
	await grid(page).getByRole('button', { name: 'Month', exact: true }).click();
	await expect(grid(page).getByText('Design review')).toBeVisible();
	// Archive and delete keys pressed in the calendar must not touch the mail list.
	await page.keyboard.press('e');
	await page.keyboard.press('#');
	await page.locator('mail-app .rail').getByRole('button', { name: 'Mail', exact: true }).click();
	await expect(row(page, 'Q3 roadmap review')).toHaveCount(1);
});

test('the calendar exports and imports iCalendar files', async ({ page }) => {
	await openDemo(page);
	await openCalendar(page);
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		grid(page).getByRole('button', { name: 'Export' }).click(),
	]);
	expect(download.suggestedFilename()).toBe('calendar.ics');
	const exported = await readFile((await download.path())!, 'utf8');
	expect(exported).toContain('BEGIN:VCALENDAR');
	expect(exported).toContain('SUMMARY:Stand-up');
	expect(exported).toContain('RRULE:FREQ=WEEKLY');
	const day = await today(page);
	const ics = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//OpenMail tests//EN',
		'BEGIN:VEVENT',
		'UID:board-meeting@example.com',
		`DTSTAMP:${day}T080000Z`,
		`DTSTART:${day}T120000Z`,
		`DTEND:${day}T130000Z`,
		'SUMMARY:Board meeting',
		'END:VEVENT',
		'END:VCALENDAR',
		'',
	].join('\r\n');
	await page.locator('mail-calendar input.file').setInputFiles({
		name: 'board.ics',
		mimeType: 'text/calendar',
		buffer: Buffer.from(ics),
	});
	await grid(page).getByRole('button', { name: 'Month', exact: true }).click();
	await expect(grid(page).getByText('Board meeting')).toBeVisible();
});
