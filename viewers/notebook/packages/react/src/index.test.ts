import { NotebookApp } from 'notebook-viewer';
import { StrictMode, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	Notebook,
	useNotebook,
	type CreateNotebookOptions,
	type NotebookClient,
	type NotebookState,
} from './index';

// These tests render through React without act(), as a browser does: React commits in one task
// and the element's first update runs in a microtask after it, so the order in which the binding
// applies props is observable.
const unique = (name: string): string => `${name}-${Math.random().toString(36).slice(2, 10)}`;

function mount() {
	const container = document.createElement('div');
	document.body.append(container);
	return { container, root: createRoot(container) };
}

/** Records the storage name `<notebook-app>` has each time it updates. */
function recordUpdates(): string[] {
	type Updating = { willUpdate(this: NotebookApp, changed: Map<string, unknown>): void };
	const prototype = NotebookApp.prototype as unknown as Updating;
	const original = prototype.willUpdate;
	const seen: string[] = [];
	vi.spyOn(prototype, 'willUpdate').mockImplementation(function (this: NotebookApp, changed) {
		seen.push(this.storageName);
		original.call(this, changed);
	});
	return seen;
}

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

describe('<Notebook>', () => {
	it('starts the element once, with the props it was given, and forwards its events', async () => {
		const storageName = unique('react-notebook');
		const seen = recordUpdates();
		const onReady = vi.fn();
		const onNavigate = vi.fn();
		const { container, root } = mount();
		root.render(
			createElement(
				StrictMode,
				null,
				createElement(Notebook, {
					className: 'notes host',
					userName: 'Ada',
					userId: 'u-ada',
					storageName,
					theme: 'dark',
					onReady,
					onNavigate,
				}),
			),
		);
		try {
			await vi.waitFor(() => expect(onReady).toHaveBeenCalled(), { timeout: 10_000 });
			const el = container.querySelector('notebook-app') as NotebookApp;
			expect(onReady).toHaveBeenCalledWith({ user: { id: 'u-ada', name: 'Ada' } });
			expect(onNavigate).toHaveBeenCalled();
			expect(el.className).toBe('notes host');
			expect(el.style.height).toBe('100%');
			expect(el.getAttribute('data-office-theme')).toBe('dark');
			expect(el.client?.getState().user).toMatchObject({ id: 'u-ada', name: 'Ada' });
			// The very first update already had the storage: no client ever opened the default one.
			expect(seen.length).toBeGreaterThan(0);
			expect(seen.filter((name) => name !== storageName)).toEqual([]);
		} finally {
			root.unmount();
		}
	});

	it('stops forwarding events once unmounted', async () => {
		const onNavigate = vi.fn();
		const { container, root } = mount();
		root.render(createElement(Notebook, { storageName: unique('react-unmount'), onNavigate }));
		await vi.waitFor(() => expect(container.querySelector('notebook-app')).not.toBeNull());
		const el = container.querySelector('notebook-app') as NotebookApp;
		const detail = { notebookId: 'n', sectionId: 's', pageId: 'p' };
		await vi.waitFor(() => expect(onNavigate).toHaveBeenCalled(), { timeout: 10_000 });
		root.unmount();
		const calls = onNavigate.mock.calls.length;
		el.dispatchEvent(new CustomEvent('notebook-navigate', { detail }));
		expect(onNavigate).toHaveBeenCalledTimes(calls);
	});
});

describe('useNotebook', () => {
	it('creates a client after mount, re-renders on every change and destroys it on unmount', async () => {
		const options: CreateNotebookOptions = {
			user: { id: 'u-ada', name: 'Ada' },
			storageName: unique('react-hook'),
		};
		const seen: { client: NotebookClient | null; state: NotebookState | null } = {
			client: null,
			state: null,
		};
		function Probe() {
			const notebook = useNotebook(options);
			seen.client = notebook.client;
			seen.state = notebook.state;
			const pages = notebook.state?.pages.length ?? 0;
			return createElement('output', null, notebook.state?.ready ? `pages:${pages}` : 'opening');
		}
		const { container, root } = mount();
		root.render(createElement(Probe));
		await vi.waitFor(() => expect(container.textContent).toBe('pages:1'), { timeout: 10_000 });
		const client = seen.client!;
		expect(seen.state?.user.name).toBe('Ada');
		client.createPage({ title: 'Ideas' });
		await vi.waitFor(() => expect(container.textContent).toBe('pages:2'));
		expect(seen.state?.pages.map((page) => page.title)).toContain('Ideas');
		const destroy = vi.spyOn(client, 'destroy');
		root.unmount();
		expect(destroy).toHaveBeenCalledOnce();
		await destroy.mock.results[0]?.value;
	});
});
