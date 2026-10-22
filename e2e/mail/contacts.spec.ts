import { expect, test } from '@playwright/test';
import { openDemo } from './helpers';

test('the address book on its own takes one column when its own width is narrow', async ({
	page,
}) => {
	await openDemo(page);
	// Outside the app, in a narrow host of its own: no container above it to follow.
	const columns = await page.evaluate(async () => {
		const host = document.createElement('div');
		host.style.cssText = 'position:fixed;inset:0 auto auto 0;width:400px;height:600px';
		const contacts = document.createElement('mail-contacts') as HTMLElement & {
			updateComplete: Promise<unknown>;
		};
		host.append(contacts);
		document.body.append(host);
		await contacts.updateComplete;
		const pane = contacts.shadowRoot!.querySelector('.pane')!;
		return getComputedStyle(pane).gridTemplateColumns.split(' ').length;
	});
	expect(columns).toBe(1);
});
