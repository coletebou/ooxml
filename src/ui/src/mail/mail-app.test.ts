// @vitest-environment jsdom
import type { MailState } from 'ooxml-core/mail';
import { defineMailApp, type MailApp } from './mail-app';

beforeAll(() => defineMailApp());
afterEach(() => document.body.replaceChildren());

async function until(test: () => boolean): Promise<void> {
	for (let i = 0; i < 400; i++) {
		if (test()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error('timed out');
}

async function mount(): Promise<MailApp> {
	const app = document.createElement('mail-app') as MailApp;
	document.body.append(app);
	await until(() => (app.client?.getState().conversations.length ?? 0) > 5);
	await app.updateComplete;
	return app;
}

const state = (app: MailApp): MailState => app.client!.getState();
const inner = <T extends Element>(host: Element | null | undefined, selector: string) =>
	(host?.shadowRoot?.querySelector(selector) ?? null) as T | null;

describe('<mail-app>', () => {
	it('opens the demo mailbox and lists the Inbox', async () => {
		const app = await mount();
		const list = inner<HTMLElement & { updateComplete: Promise<unknown> }>(
			app,
			'mail-message-list',
		)!;
		await list.updateComplete;
		const rows = list.shadowRoot!.querySelectorAll('.row');
		expect(rows.length).toBeGreaterThan(5);
		expect(rows[0]!.textContent).toContain('This week: offline-first apps');
		const folders = inner(app, 'mail-folder-pane')!.shadowRoot!.textContent!;
		expect(folders).toContain('Inbox');
		expect(folders).toContain('Projects');
	});

	it('opens a conversation in the reading pane', async () => {
		const app = await mount();
		const id = state(app).conversations.find((c) => c.subject === 'Q3 roadmap review')!.id;
		await app.client!.open(id);
		await app.updateComplete;
		const pane = inner<HTMLElement & { updateComplete: Promise<unknown> }>(
			app,
			'mail-reading-pane',
		)!;
		await pane.updateComplete;
		expect(pane.shadowRoot!.querySelector('h2')!.textContent).toBe('Q3 roadmap review');
		// Threads are per folder (RFC 5256): the Inbox holds the request and two replies; the reply
		// sent from this account is in Sent (see viewers/mail/docs/limitations.md).
		expect(pane.shadowRoot!.querySelectorAll('article.message')).toHaveLength(3);
	});

	it('follows its locale everywhere', async () => {
		const app = await mount();
		app.locale = 'de';
		await app.updateComplete;
		const folders = inner<HTMLElement & { updateComplete: Promise<unknown> }>(
			app,
			'mail-folder-pane',
		)!;
		await folders.updateComplete;
		expect(folders.shadowRoot!.textContent).toContain('Posteingang');
		expect(app.shadowRoot!.textContent).toContain('Neue Nachricht');
	});

	it('keeps its client for an equal connection and reconnects for another', async () => {
		const app = document.createElement('mail-app') as MailApp;
		app.config = { kind: 'demo', seed: { now: Date.UTC(2026, 9, 20) } };
		document.body.append(app);
		const first = app.client;
		expect(first).not.toBeNull();
		await app.updateComplete;
		expect(app.client).toBe(first);
		// A framework writing its connection inline hands over a new, equal object on every render.
		app.config = { kind: 'demo', seed: { now: Date.UTC(2026, 9, 20) } };
		await app.updateComplete;
		expect(app.client).toBe(first);
		app.config = { kind: 'demo', seed: { now: Date.UTC(2026, 9, 21) } };
		await app.updateComplete;
		expect(app.client).not.toBe(first);
		expect(app.client).not.toBeNull();
	});

	it('defines and shows the calendar and contacts views on its own', async () => {
		const app = await mount();
		for (const [view, tag] of [
			['calendar', 'mail-calendar'],
			['contacts', 'mail-contacts'],
		] as const) {
			app.view = view;
			await app.updateComplete;
			const pane = inner<HTMLElement & { updateComplete: Promise<unknown> }>(app, tag)!;
			expect(customElements.get(tag), tag).toBeDefined();
			await pane.updateComplete;
			expect(pane.shadowRoot!.childElementCount, tag).toBeGreaterThan(0);
		}
	});

	it('leaves the mail selection alone while another view shows', async () => {
		const app = await mount();
		const id = state(app).conversations[0]!.id;
		app.client!.focus(id);
		app.view = 'calendar';
		await app.updateComplete;
		const archive = new KeyboardEvent('keydown', {
			key: 'e',
			bubbles: true,
			composed: true,
			cancelable: true,
		});
		app.dispatchEvent(archive);
		expect(archive.defaultPrevented).toBe(false);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(state(app).conversations.some((c) => c.id === id)).toBe(true);
		app.view = 'mail';
		await app.updateComplete;
		const again = new KeyboardEvent('keydown', {
			key: 'e',
			bubbles: true,
			composed: true,
			cancelable: true,
		});
		app.dispatchEvent(again);
		expect(again.defaultPrevented).toBe(true);
		await until(() => !state(app).conversations.some((c) => c.id === id));
	});

	it('opens compose from the keyboard and closes it with Escape', async () => {
		const app = await mount();
		app.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true, composed: true }));
		await until(() => state(app).compose !== null);
		await app.updateComplete;
		expect(inner(app, 'mail-compose')).not.toBeNull();
		app.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
		);
		await until(() => state(app).compose === null);
	});
});
