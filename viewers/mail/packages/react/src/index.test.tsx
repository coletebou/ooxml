// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MailApp, MailClient, MailOptions } from 'mail-viewer';
import { Mail, useMail } from './index';

beforeAll(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => document.body.replaceChildren());

const NOW = Date.UTC(2026, 9, 20);

function root(): { root: Root; container: HTMLElement } {
	const container = document.createElement('div');
	document.body.append(container);
	return { root: createRoot(container), container };
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
});
