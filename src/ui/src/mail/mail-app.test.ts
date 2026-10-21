// @vitest-environment jsdom
import {
	createDemoSeed,
	createMemoryTransport,
	MailTransportError,
	type Draft,
	type MailState,
	type MailTransport,
} from 'ooxml-core/mail';
import { defineMailApp, type MailApp } from './mail-app';
import type { MailConnection } from './store';

type Updating = HTMLElement & { updateComplete: Promise<unknown> };

beforeAll(() => defineMailApp());
afterEach(() => document.body.replaceChildren());

async function until(test: () => boolean): Promise<void> {
	for (let i = 0; i < 400; i++) {
		if (test()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error('timed out');
}

async function mount(config?: MailConnection): Promise<MailApp> {
	const app = document.createElement('mail-app') as MailApp;
	if (config) app.config = config;
	document.body.append(app);
	await until(() => (app.client?.getState().conversations.length ?? 0) > 5);
	await app.updateComplete;
	return app;
}

const state = (app: MailApp): MailState => app.client!.getState();
const inner = <T extends Element>(host: Element | null | undefined, selector: string) =>
	(host?.shadowRoot?.querySelector(selector) ?? null) as T | null;
const key = (name: string, init: KeyboardEventInit = {}) =>
	new KeyboardEvent('keydown', {
		key: name,
		bubbles: true,
		composed: true,
		cancelable: true,
		...init,
	});

/**
 * The demo mailbox through a transport that, like the JMAP one, abandons the requests still running
 * when it is closed, and that records what it saved and sent. Its first `failSaves` saves fail.
 */
function testTransport(options: { failSaves?: number } = {}) {
	const base = createMemoryTransport(createDemoSeed({ now: Date.UTC(2026, 9, 20) }));
	const saved: Draft[] = [];
	const sent: Draft[] = [];
	let closed = false;
	let failSaves = options.failSaves ?? 0;
	const request = async (): Promise<void> => {
		await new Promise((resolve) => setTimeout(resolve, 5));
		if (closed) throw new MailTransportError('network', 'The transport is closed.');
	};
	const transport: MailTransport = {
		...base,
		async saveDraft(draft) {
			await request();
			if (failSaves-- > 0) throw new MailTransportError('server', 'Saving failed.');
			saved.push(draft);
			return base.saveDraft(draft);
		},
		async send(draft) {
			await request();
			sent.push(draft);
			return base.send(draft);
		},
		close() {
			closed = true;
			base.close();
		},
	};
	return { transport, saved, sent, closed: () => closed };
}

/** Open a new message and type `address` into its To field without finishing it. */
async function typeAddress(app: MailApp, address: string): Promise<Updating> {
	await app.client!.compose('new');
	await app.updateComplete;
	const compose = inner<Updating>(app, 'mail-compose')!;
	await compose.updateComplete;
	const to = inner<Updating>(compose, 'mail-recipients')!;
	await to.updateComplete;
	const field = inner<HTMLInputElement>(to, 'input')!;
	field.value = address;
	field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
	await to.updateComplete;
	return compose;
}

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

	it('moves the focus into the reading pane when opening hides the list', async () => {
		const app = await mount();
		// A narrow app hides the list once a conversation is open (a container query jsdom cannot run).
		const list = app.shadowRoot!.querySelector<HTMLElement>('.list-pane')!;
		Object.defineProperty(list, 'checkVisibility', { value: () => false, configurable: true });
		const id = state(app).conversations[0]!.id;
		inner(app, 'mail-message-list')!.dispatchEvent(
			new CustomEvent('mail-open', { detail: { id }, bubbles: true, composed: true }),
		);
		await until(() => app.shadowRoot!.activeElement?.tagName === 'MAIL-READING-PANE');
		const pane = inner<HTMLElement>(app, 'mail-reading-pane')!;
		expect(pane.shadowRoot!.activeElement?.closest('.toolbar')).not.toBeNull();
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

	it('saves the open draft before it lets its connection go', async () => {
		const { transport, saved, closed } = testTransport();
		const app = await mount({ kind: 'transport', transport });
		await app.client!.compose('new');
		app.client!.updateDraft({ subject: 'Unsent thoughts' });
		app.remove();
		await until(closed);
		expect(saved.map((draft) => draft.subject)).toEqual(['Unsent thoughts']);
	});

	it('keeps trying to save a draft it could not save, without holding up the next client', async () => {
		const { transport, saved, closed } = testTransport({ failSaves: 2 });
		const app = await mount({ kind: 'transport', transport });
		await app.client!.compose('new');
		vi.useFakeTimers();
		try {
			app.client!.updateDraft({ subject: 'Unsent thoughts' });
			const first = app.client;
			app.config = { kind: 'demo', seed: { now: Date.UTC(2026, 9, 20) } };
			await app.updateComplete;
			// The new connection is up at once while the old client tries again in the background.
			expect(app.client).not.toBe(first);
			expect(app.client).not.toBeNull();
			await vi.advanceTimersByTimeAsync(1_000);
			expect([saved.length, closed()]).toEqual([0, false]);
			await vi.advanceTimersByTimeAsync(60_000);
			expect(saved.map((draft) => draft.subject)).toEqual(['Unsent thoughts']);
			expect(closed()).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it('leaves what is typed for the next client alone while the last one tries again', async () => {
		const { transport, closed } = testTransport({ failSaves: 2 });
		const app = await mount({ kind: 'transport', transport });
		await app.client!.compose('new');
		vi.useFakeTimers();
		try {
			app.client!.updateDraft({ subject: 'Unsent thoughts' });
			app.config = { kind: 'demo', seed: { now: Date.UTC(2026, 9, 20) } };
			await app.updateComplete;
			const compose = await typeAddress(app, 'ada@example.com');
			await vi.advanceTimersByTimeAsync(60_000);
			expect(closed()).toBe(true);
			expect(state(app).compose?.draft.to).toEqual([]);
			const field = inner<HTMLInputElement>(inner(compose, 'mail-recipients'), 'input')!;
			expect(field.value).toBe('ada@example.com');
		} finally {
			vi.useRealTimers();
		}
	});

	it('leaves Enter on a button to the button and opens from the list', async () => {
		const app = await mount();
		const [first, second] = state(app).conversations;
		await app.client!.open(second!.id);
		app.client!.focus(first!.id);
		await app.client!.compose('new');
		await app.updateComplete;
		const reading = inner<Updating>(app, 'mail-reading-pane')!;
		const compose = inner<Updating>(app, 'mail-compose')!;
		await reading.updateComplete;
		await compose.updateComplete;
		const buttons = [
			inner(app, '.list-toolbar button')!,
			inner(app, '.topbar .primary')!,
			inner(reading, '.toolbar button')!,
			inner(compose, '.send')!,
		];
		for (const button of buttons) {
			const enter = key('Enter');
			button.dispatchEvent(enter);
			expect(enter.defaultPrevented, button.className).toBe(false);
		}
		expect(state(app).open?.id).toBe(second!.id);
		const enter = key('Enter');
		inner(inner(app, 'mail-message-list'), '.viewport')!.dispatchEvent(enter);
		expect(enter.defaultPrevented).toBe(true);
		await until(() => state(app).open?.id === first!.id);
	});

	it('keeps an address still being typed when Escape closes or Ctrl+Enter sends', async () => {
		const { transport, saved, sent } = testTransport();
		const app = await mount({ kind: 'transport', transport });
		let compose = await typeAddress(app, 'ada@example.com');
		inner(inner(compose, 'mail-recipients'), 'input')!.dispatchEvent(key('Escape'));
		await until(() => state(app).compose === null);
		expect(saved.at(-1)?.to).toEqual([{ name: '', email: 'ada@example.com' }]);
		// Sent from another field before the address field's own late commit runs.
		compose = await typeAddress(app, 'bob@example.com');
		inner(compose, '.subject')!.dispatchEvent(key('Enter', { ctrlKey: true }));
		await until(() => sent.length === 1);
		expect(sent[0]!.to).toEqual([{ name: '', email: 'bob@example.com' }]);
	});

	it('keeps a draft it could not save when a link or a contact starts a new one', async () => {
		const { transport } = testTransport({ failSaves: Infinity });
		const app = await mount({ kind: 'transport', transport });
		const kept = { subject: 'Kept', to: [{ name: '', email: 'ada@example.com' }] };
		await app.client!.compose('new');
		app.client!.updateDraft(kept);
		await app.mailto('mailto:bob@example.com?subject=Other');
		expect(state(app).compose?.draft).toMatchObject(kept);
		app.view = 'contacts';
		await app.updateComplete;
		const compose = vi.spyOn(app.client!, 'compose');
		inner(app, 'mail-contacts')!.dispatchEvent(
			new CustomEvent('mail-compose-to', {
				detail: { address: { name: 'Cy', email: 'cy@example.com' } },
				bubbles: true,
				composed: true,
			}),
		);
		await until(() => compose.mock.calls.length === 1);
		expect(await compose.mock.results[0]!.value).toBe(false);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(state(app).compose?.draft).toMatchObject(kept);
		// A draft that cannot be saved would keep the removed app trying in the background.
		await app.client!.discardDraft();
	});

	it('names the rail and New message buttons whatever labels the layout shows', async () => {
		const app = await mount();
		const buttons = [...app.shadowRoot!.querySelectorAll('.rail-item, .topbar .primary')];
		expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
			'Mail',
			'Calendar',
			'Contacts',
			'Shortcuts',
			'New message',
		]);
	});

	it('moves the focus into the shortcuts dialog, keeps it there and gives it back', async () => {
		const app = await mount();
		const id = state(app).conversations[0]!.id;
		app.client!.focus(id);
		const list = inner<HTMLElement>(inner(app, 'mail-message-list'), '.viewport')!;
		list.focus();
		list.dispatchEvent(key('?'));
		await app.updateComplete;
		const close = inner<HTMLButtonElement>(app, '[role="dialog"] button')!;
		expect(app.shadowRoot!.activeElement).toBe(close);
		const tab = key('Tab');
		close.dispatchEvent(tab);
		expect(tab.defaultPrevented).toBe(true);
		expect(app.shadowRoot!.activeElement).toBe(close);
		// The app's shortcuts never see the dialog's keys.
		const archive = key('e');
		close.dispatchEvent(archive);
		expect(archive.defaultPrevented).toBe(false);
		close.dispatchEvent(key('Escape'));
		await app.updateComplete;
		expect(inner(app, '[role="dialog"]')).toBeNull();
		expect(inner(app, 'mail-message-list')!.shadowRoot!.activeElement).toBe(list);
		expect(state(app).conversations.some((c) => c.id === id)).toBe(true);
	});
});
