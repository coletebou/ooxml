// @vitest-environment jsdom
import type { MockInstance } from 'vitest';
import { defineMailApp, type MailApp } from './mail-app';
import type { MailReadingPane } from './reading-pane';

beforeAll(() => defineMailApp());
afterEach(() => document.body.replaceChildren());

async function until(test: () => boolean): Promise<void> {
	for (let i = 0; i < 400; i++) {
		if (test()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error('timed out');
}

/** Wait until `updates` sees no update for a while: bodies shown, frames and pictures settled. */
async function settled(updates: MockInstance): Promise<void> {
	let seen = -1;
	while (seen !== updates.mock.calls.length) {
		seen = updates.mock.calls.length;
		await new Promise((resolve) => setTimeout(resolve, 30));
	}
}

describe('the mail view', () => {
	it('leaves the reading pane alone when the app changes what it does not show', async () => {
		const app = document.createElement('mail-app') as MailApp;
		document.body.append(app);
		await until(() => (app.client?.getState().conversations.length ?? 0) > 5);
		await app.updateComplete;
		const pane = app.shadowRoot!.querySelector<MailReadingPane>('mail-reading-pane')!;
		const updates = vi.spyOn(pane as unknown as { update(changed: unknown): void }, 'update');
		try {
			const [first, second] = app.client!.getState().conversations;
			await app.client!.open(first!.id);
			await settled(updates);
			updates.mockClear();
			// Selecting a row of the list changes the app's state, and nothing the pane shows.
			app.client!.toggleSelected(second!.id);
			await until(() => app.client!.getState().selection.length === 1);
			await app.updateComplete;
			await settled(updates);
			const changed = updates.mock.calls.map(([keys]) => [
				...(keys as Map<string, unknown>).keys(),
			]);
			expect(changed).toEqual([]);
		} finally {
			updates.mockRestore();
		}
	});

	it('offers no "select all" over an empty list, where a click would show a selection', async () => {
		const app = document.createElement('mail-app') as MailApp;
		document.body.append(app);
		await until(() => (app.client?.getState().conversations.length ?? 0) > 0);
		await app.client!.search('no message says zqxjv');
		await until(() => app.client!.getState().conversations.length === 0);
		await app.updateComplete;
		const box = app.shadowRoot!.querySelector<HTMLInputElement>('.list-toolbar input')!;
		box.click();
		await app.updateComplete;
		expect(app.client!.getState().selection).toEqual([]);
		expect(box.disabled).toBe(true);
		expect(box.checked).toBe(false);
	});
});
