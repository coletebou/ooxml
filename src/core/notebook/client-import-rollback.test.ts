// An archive whose content cannot be written must not leave an empty notebook behind. The snapshot
// writer is replaced to fail, as any unforeseen bad input would.
import { afterEach, expect, it, vi } from 'vitest';
import { createNotebookClient } from './client';
import type { NotebookClient } from './client-types';
import { createMemoryStorage } from './storage';
import { createChannelHub, settle } from './test-support/channel';

vi.mock('./snapshot', async (importOriginal) => ({
	...(await importOriginal<typeof import('./snapshot')>()),
	writeSnapshot: () => {
		throw new Error('the archive could not be written');
	},
}));

let client: NotebookClient | null = null;
afterEach(async () => {
	await client?.destroy();
	client = null;
});

async function until(check: () => boolean, ms = 3000): Promise<void> {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw new Error('timed out');
		await settle(5);
	}
}

it('drops a notebook whose archive cannot be written and goes back to the open one', async () => {
	client = createNotebookClient({
		user: { name: 'Ada' },
		storage: createMemoryStorage(),
		BroadcastChannel: createChannelHub(),
		saveDelayMs: 5,
		names: { notebook: 'Notebook', section: 'Section' },
	});
	await client.whenReady();
	await settle();
	const first = client.getState().notebookId;
	const notices: string[] = [];
	client.on('notice', (n) => notices.push(n.code));
	const archive = await client.exportNotebook();
	await expect(client.importNotebook(archive.bytes)).rejects.toThrow();
	const c = client;
	await until(() => c.getState().notebookId === first && !c.getState().loading);
	expect(c.getState().notebooks.map((n) => n.id)).toEqual([first]);
	expect(c.getState().pages).toHaveLength(1);
	expect(notices).toContain('open-failed');
});
