// @vitest-environment jsdom
import { act, createElement, StrictMode, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
	createDemoSeed,
	createMemoryContactStore,
	createMemoryTransport,
	emptyContact,
	type MailTransport,
} from 'ooxml-core/mail';
import { MailApp, type MailClient, type MailConnection, type MailOptions } from 'mail-viewer';
import { Mail, useMail, useMailClient } from './index';

beforeAll(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => document.body.replaceChildren());

const NOW = Date.UTC(2026, 9, 20);

function root(): { root: Root; container: HTMLElement } {
	const container = document.createElement('div');
	document.body.append(container);
	return { root: createRoot(container), container };
}

/** The demo mailbox through a transport of the host's own, which records when it is closed. */
function hostTransport(): { transport: MailTransport; closed: () => boolean } {
	const base = createMemoryTransport(createDemoSeed({ now: NOW }));
	let closed = false;
	const transport: MailTransport = {
		...base,
		close() {
			closed = true;
			base.close();
		},
	};
	return { transport, closed: () => closed };
}

/** Let React and the clients run for `ms`, `times` times or until `done`. */
async function waitFor(done: () => boolean, ms = 5, times = 200): Promise<void> {
	for (let i = 0; i < times && !done(); i++)
		await act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
}

describe('<Mail>', () => {
	it('mounts one element, forwards props and keeps its client while the config is written inline', async () => {
		const { root: view, container } = root();
		const onNotice = vi.fn();
		const render = (locale: string): Promise<void> =>
			act(async () => {
				view.render(
					createElement(Mail, {
						config: { kind: 'demo', seed: { now: NOW } },
						locale,
						className: 'inbox',
						onNotice,
					}),
				);
			});
		await render('de');
		const el = container.querySelector('mail-app') as MailApp;
		await el.updateComplete;
		expect(el.locale).toBe('de');
		expect(el.getAttribute('class')).toBe('inbox');
		const client = el.client;
		expect(client).not.toBeNull();
		await render('fr');
		await el.updateComplete;
		expect(container.querySelectorAll('mail-app')).toHaveLength(1);
		expect(el.locale).toBe('fr');
		expect(el.client).toBe(client);
		el.dispatchEvent(
			new CustomEvent('mail-notice', { detail: { kind: 'done', action: 'sent', count: 1 } }),
		);
		expect(onNotice).toHaveBeenCalledWith({ kind: 'done', action: 'sent', count: 1 });
		await act(async () => view.unmount());
		expect(el.client).toBeNull();
	});

	it('shows the mail view again once the view prop is taken away', async () => {
		const { root: tree, container } = root();
		await act(async () => tree.render(createElement(Mail, { view: 'calendar' })));
		const el = container.querySelector('mail-app') as MailApp;
		expect(el.view).toBe('calendar');
		await act(async () => tree.render(createElement(Mail, {})));
		expect(el.view).toBe('mail');
		await act(async () => tree.unmount());
	});

	it('gives the element its connection before it starts, so no demo mailbox shows first', async () => {
		// Outside act(), React runs the effects in their real order: the passive ones come after the
		// element's first update (and, in a browser, after a paint).
		vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false);
		const started: (MailConnection | null)[] = [];
		const proto = MailApp.prototype as unknown as { start(): void };
		const start = proto.start;
		const spy = vi.spyOn(proto, 'start').mockImplementation(function (this: MailApp) {
			started.push(this.config);
			start.call(this);
		});
		try {
			const { root: view } = root();
			const config: MailConnection = { kind: 'demo', seed: { now: NOW, bulk: 3 } };
			view.render(createElement(Mail, { config }));
			for (let i = 0; i < 40; i++) await new Promise((resolve) => setTimeout(resolve, 5));
			expect(started).toEqual([config]);
			view.unmount();
		} finally {
			spy.mockRestore();
			vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
		}
	});

	it('keeps its element, client and the transport it was given through StrictMode', async () => {
		const { transport, closed } = hostTransport();
		const { root: view, container } = root();
		await act(async () => {
			view.render(
				createElement(
					StrictMode,
					null,
					createElement(Mail, { config: { kind: 'transport', transport } }),
				),
			);
		});
		const el = container.querySelector('mail-app') as MailApp;
		await el.updateComplete;
		const client = el.client;
		await waitFor(() => client?.getState().status === 'ready');
		await waitFor(() => false, 10, 5);
		expect([container.querySelectorAll('mail-app').length, el.client, closed()]).toEqual([
			1,
			client,
			false,
		]);
		expect(client?.getState().status).toBe('ready');
		const destroy = vi.spyOn(client!, 'destroy');
		await act(async () => view.unmount());
		// Unmounted, the element lets its client go; the transport stays the host's to close.
		await waitFor(() => destroy.mock.calls.length > 0);
		expect([destroy.mock.calls.length, closed()]).toEqual([1, false]);
		destroy.mockRestore();
	});
});

describe('useMail', () => {
	it('keeps one client while the options are written inline and destroys it on unmount', async () => {
		const seen: (MailClient | null)[] = [];
		function Probe({ options }: { options: MailOptions }): ReactElement {
			const { client, state } = useMail(options);
			seen.push(client);
			return createElement('output', null, state?.status ?? 'none');
		}
		const { root: view, container } = root();
		const render = (): Promise<void> =>
			act(async () => {
				view.render(
					createElement(Probe, { options: { config: { kind: 'demo', seed: { now: NOW } } } }),
				);
			});
		await render();
		await render();
		await render();
		const clients = new Set(seen.filter(Boolean));
		expect(clients.size).toBe(1);
		const [client] = clients;
		for (let i = 0; i < 200 && client!.getState().status !== 'ready'; i++)
			await act(() => new Promise((done) => setTimeout(done, 5)));
		expect(container.textContent).toBe('ready');
		const destroy = vi.spyOn(client!, 'destroy');
		await act(async () => view.unmount());
		// Destroyed once its open draft (none here) is closed, which is asynchronous.
		for (let i = 0; i < 200 && !destroy.mock.calls.length; i++)
			await act(() => new Promise((done) => setTimeout(done, 5)));
		expect(destroy).toHaveBeenCalledOnce();
		destroy.mockRestore();
	});

	it('never returns the last client once the options asked for another or for none', async () => {
		const seen: (MailClient | null)[] = [];
		function Probe({ options }: { options: MailOptions | null }): ReactElement {
			seen.push(useMailClient(options));
			return createElement('output');
		}
		const { root: view } = root();
		const render = (options: MailOptions | null): Promise<void> =>
			act(async () => view.render(createElement(Probe, { options })));
		const config: MailConnection = { kind: 'demo', seed: { now: NOW } };
		await render({ config });
		const first = seen.at(-1)!;
		expect(first).not.toBeNull();
		// Another address book: from the render that asks for it on, the first client is gone.
		let from = seen.length;
		await render({ config, contacts: createMemoryContactStore() });
		expect(seen.slice(from)).not.toContain(first);
		const second = seen.at(-1)!;
		expect(second).not.toBeNull();
		from = seen.length;
		await render(null);
		expect(seen.slice(from)).toEqual(seen.slice(from).map(() => null));
		await act(async () => view.unmount());
	});

	it('makes a new client for a store given later, and keeps it for new quote wording', async () => {
		const seen: (MailClient | null)[] = [];
		function Probe({ options }: { options: MailOptions }): ReactElement {
			seen.push(useMail(options).client);
			return createElement('output');
		}
		const { root: view } = root();
		const render = (options: MailOptions): Promise<void> =>
			act(async () => view.render(createElement(Probe, { options })));
		const config: MailConnection = { kind: 'demo', seed: { now: NOW } };
		await render({ config });
		const first = seen.at(-1)!;
		// The host's own address book, given once it has loaded.
		const contacts = createMemoryContactStore({
			seed: [{ ...emptyContact('kim', 0), name: 'Kim from the host' }],
		});
		await render({ config, contacts });
		const client = seen.at(-1)!;
		expect(client).not.toBe(first);
		await waitFor(() => client.getState().contacts.some((c) => c.name === 'Kim from the host'));
		expect(client.getState().contacts.map((c) => c.name)).toEqual(['Kim from the host']);
		// Quote wording written inline, new on every render: the same client, the latest wording.
		const reply = async (said: string): Promise<string> => {
			await render({
				config,
				contacts,
				quoteFormat: { attribution: () => said, forwardHeader: () => [] },
			});
			expect(seen.at(-1)).toBe(client);
			await waitFor(() => client.getState().status === 'ready');
			const latest = client.getState().conversations[0]!.latestId;
			expect(await client.compose('reply', latest)).toBe(true);
			return client.getState().compose!.draft.text;
		};
		expect(await reply('Ada said:')).toContain('Ada said:');
		expect(await reply('Ada wrote:')).toContain('Ada wrote:');
		await act(async () => view.unmount());
	});

	it('keeps the transport it was given open for the client that replaces the last one', async () => {
		const { transport, closed } = hostTransport();
		const config: MailConnection = { kind: 'transport', transport };
		const seen: (MailClient | null)[] = [];
		function Probe({ options }: { options: MailOptions }): ReactElement {
			seen.push(useMail(options).client);
			return createElement('output');
		}
		const { root: view } = root();
		const render = (options: MailOptions): Promise<void> =>
			act(async () => view.render(createElement(Probe, { options })));
		await render({ config, storage: null });
		const first = seen.at(-1)!;
		await waitFor(() => first.getState().status === 'ready');
		const destroy = vi.spyOn(first, 'destroy');
		// A new address book on the same transport: a new client, and the last one is let go.
		await render({ config, storage: null, contacts: createMemoryContactStore() });
		const client = seen.at(-1)!;
		expect(client).not.toBe(first);
		await waitFor(() => destroy.mock.calls.length > 0);
		expect(destroy).toHaveBeenCalledOnce();
		expect(closed()).toBe(false);
		await waitFor(() => client.getState().status === 'ready');
		expect(await client.compose('new')).toBe(true);
		client.updateDraft({ to: [{ name: 'Ben', email: 'ben@example.com' }], subject: 'Still here' });
		expect(await client.send()).toBe(true);
		await act(async () => view.unmount());
		destroy.mockRestore();
	});

	it('keeps one client, and the transport it was given open, through StrictMode', async () => {
		// StrictMode runs the effect, its cleanup and the effect again: the client of the first run
		// is the one kept, not let go in between for a second one to connect again.
		const { transport, closed } = hostTransport();
		const options: MailOptions = { config: { kind: 'transport', transport } };
		const seen = new Set<MailClient>();
		function Probe(): ReactElement {
			const { client, state } = useMail(options);
			if (client) seen.add(client);
			return createElement('output', null, state?.status ?? 'none');
		}
		const { root: view, container } = root();
		await act(async () => {
			view.render(createElement(StrictMode, null, createElement(Probe)));
		});
		await waitFor(() => ['ready', 'error'].includes(container.textContent ?? ''));
		await waitFor(() => false, 10, 5);
		expect([container.textContent, closed(), seen.size]).toEqual(['ready', false, 1]);
		const [client] = seen;
		const destroy = vi.spyOn(client!, 'destroy');
		await act(async () => view.unmount());
		// Unmounted, the hook lets its client go; the transport stays the host's to close.
		await waitFor(() => destroy.mock.calls.length > 0);
		expect([destroy.mock.calls.length, closed()]).toEqual([1, false]);
		destroy.mockRestore();
	});
});
