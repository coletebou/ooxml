import { IDBFactory } from 'fake-indexeddb';
import { createMemoryStorage, isEntityId } from 'ooxml-core/notebook';
import type { NotebookClient, NotebookStorage } from 'ooxml-core/notebook';
import { vi } from 'vitest';
import { createNotebook, notebookNames, notebookScope } from './store';

/** The registry channel a client created through `createNotebook` listens on. */
async function registryChannel(options: Parameters<typeof createNotebook>[0]): Promise<string> {
	const names: string[] = [];
	class Channel {
		onmessage = null;
		constructor(name: string) {
			names.push(name);
		}
		postMessage(): void {}
		close(): void {}
	}
	const client: NotebookClient = createNotebook({ ...options, BroadcastChannel: Channel });
	await client.whenReady();
	await client.destroy();
	const found = names.find((name) => name.includes('nb-registry'));
	if (!found) throw new Error('no registry channel');
	return found;
}

describe('notebook store helpers', () => {
	it('gives every database name its own scope, also names that clean up alike', () => {
		const names = ['notes.ada', 'notes/ada', 'notes-ada', 'x'.repeat(60), `${'x'.repeat(60)}y`];
		const scopes = names.map(notebookScope);
		expect(new Set(scopes).size).toBe(names.length);
		for (const scope of scopes) expect(isEntityId(scope) && scope.length <= 48).toBe(true);
		expect(notebookScope('notes.ada')).toBe(scopes[0]);
	});

	it('keeps the language names for what a partial host override leaves out', async () => {
		const client = createNotebook({
			storage: createMemoryStorage(),
			locale: 'de',
			names: { section: 'Kapitel' },
		});
		await client.whenReady();
		await vi.waitFor(() => expect(client.getState().notebook).not.toBeNull());
		expect(client.getState().notebook?.name).toBe('Mein Notizbuch');
		expect(client.getState().sections[0]?.name).toMatch(/^Kapitel/u);
		await client.destroy();
	});

	it('names new items in the language asked for', () => {
		expect(notebookNames('de')).toEqual({
			notebook: 'Mein Notizbuch',
			section: 'Neuer Abschnitt',
			group: expect.any(String),
		});
		expect(notebookNames().section).toBe('New Section');
	});

	it('gives a storage the host passes in its own notebook list, not the default database one', async () => {
		const ownDefault = await registryChannel({ storage: createMemoryStorage() });
		const byName = await registryChannel({});
		expect(ownDefault).not.toBe(byName);
		const a = createMemoryStorage();
		const b = createMemoryStorage();
		const sameA = [await registryChannel({ storage: a }), await registryChannel({ storage: a })];
		expect(sameA[0]).toBe(sameA[1]);
		expect(await registryChannel({ storage: b })).not.toBe(sameA[0]);
		// A storage that names where its bytes go shares the list of the database of that name.
		const named: NotebookStorage = { ...createMemoryStorage(), id: 'notes.ada' };
		expect(await registryChannel({ storage: named })).toBe(
			await registryChannel({ storageName: 'notes.ada' }),
		);
	});

	it('closes the database it opened when the client is destroyed', async () => {
		const factory = new IDBFactory();
		vi.stubGlobal('indexedDB', factory);
		try {
			const name = `nb-close-${Math.random().toString(36).slice(2)}`;
			const client = createNotebook({ storageName: name });
			await client.whenReady();
			await client.flush();
			await client.destroy();
			// An open connection would block the delete (a host removing a signed-out profile).
			const outcome = await new Promise<string>((resolve) => {
				const request = factory.deleteDatabase(name);
				request.onsuccess = () => resolve('deleted');
				request.onblocked = () => resolve('blocked');
			});
			expect(outcome).toBe('deleted');
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('saves on leaving the page until the client is destroyed', async () => {
		const storage = createMemoryStorage();
		const saves = vi.spyOn(storage, 'save');
		const client = createNotebook({ storage, saveDelayMs: 60_000 });
		await client.whenReady();
		await client.flush();
		saves.mockClear();
		client.createPage({ title: 'Pending' });
		globalThis.dispatchEvent(new Event('pagehide'));
		await vi.waitFor(() => expect(saves).toHaveBeenCalled());
		await client.destroy();
		saves.mockClear();
		globalThis.dispatchEvent(new Event('pagehide'));
		await new Promise((r) => setTimeout(r, 20));
		expect(saves).not.toHaveBeenCalled();
	});
});
