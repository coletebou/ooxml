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

test('saves a contact whose imported website or address a browser would not take as typed', async ({
	page,
}) => {
	await openDemo(page);
	const saved = await page.evaluate(async () => {
		// A card's URL without a scheme, as many exports write it, and an address the form keeps as is.
		const app = document.querySelector('mail-app') as HTMLElement & {
			client: { getState(): { contacts: Record<string, unknown>[] } };
		};
		const [first] = app.client.getState().contacts;
		const contact = {
			...first,
			id: 'imported',
			url: 'www.example.com',
			emails: [{ type: '', address: '"ada lovelace"@example.com' }],
		};
		const pane = document.createElement('mail-contacts') as HTMLElement & {
			contacts: unknown[];
			updateComplete: Promise<unknown>;
		};
		pane.contacts = [contact];
		document.body.append(pane);
		await pane.updateComplete;
		const button = (name: string) =>
			[...pane.shadowRoot!.querySelectorAll('button')].find((b) => b.textContent!.trim() === name)!;
		button('Edit').click();
		await pane.updateComplete;
		const got = new Promise<Record<string, unknown>>((resolve) =>
			pane.addEventListener('mail-save-contact', (e) =>
				resolve((e as CustomEvent<{ contact: Record<string, unknown> }>).detail.contact),
			),
		);
		pane.shadowRoot!.querySelector<HTMLButtonElement>('form button[type=submit]')!.click();
		return Promise.race([got, new Promise((resolve) => setTimeout(() => resolve(null), 1000))]);
	});
	expect(saved).toMatchObject({ url: 'www.example.com' });
});
