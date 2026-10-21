// @vitest-environment jsdom
import {
	createDemoSeed,
	createMemoryTransport,
	MailTransportError,
	type Draft,
	type MailAttachment,
	type MailMessage,
	type MailState,
	type MailTransport,
} from 'ooxml-core/mail';
import type { MailHtmlFrame } from './html-frame';
import { defineMailApp, MailApp } from './mail-app';
import type { MailConnection } from './store';

type Updating = HTMLElement & { updateComplete: Promise<unknown> };

beforeAll(() => defineMailApp());
// The apps go first: letting their clients go revokes the object URLs a test may have stubbed.
afterEach(() => {
	document.body.replaceChildren();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

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

/** The connection each client of a `<mail-app>` is started with, from now on. */
function startedWith(): (MailConnection | null)[] {
	const seen: (MailConnection | null)[] = [];
	const proto = MailApp.prototype as unknown as { start(): void };
	const start = proto.start;
	vi.spyOn(proto, 'start').mockImplementation(function (this: MailApp) {
		seen.push(this.config);
		start.call(this);
	});
	return seen;
}

/**
 * Object URLs (jsdom has none) for the rest of the test, recording the blobs made and the URLs
 * revoked.
 */
function objectUrls() {
	const made: Blob[] = [];
	const revoked: string[] = [];
	vi.stubGlobal(
		'URL',
		Object.assign(class extends URL {}, {
			createObjectURL: (blob: Blob) => `blob:test/${made.push(blob)}`,
			revokeObjectURL: (url: string) => void revoked.push(url),
		}),
	);
	return { made, revoked };
}

/** Open the demo message whose HTML shows an inline picture (an SVG logo); its message. */
async function openWelcome(app: MailApp): Promise<MailMessage> {
	const id = state(app).conversations.find((c) => c.subject === 'Welcome to the team space')!.id;
	await app.client!.open(id);
	await until(() => !!state(app).open?.messages.at(-1)?.message);
	return state(app).open!.messages.at(-1)!.message!;
}

/** `message` as another message, `id`, with `html` and an inline PNG part for each of `cids`. */
const withPictures = (message: MailMessage, id: string, html: string, ...cids: string[]) => ({
	...message,
	id,
	html,
	attachments: cids.map((cid, i): MailAttachment => ({
		partId: String(i + 2),
		blobId: `${id}-${cid}`,
		name: `${cid}.png`,
		type: 'image/png',
		size: 3,
		disposition: 'inline',
		cid,
	})),
});

/** A file whose read is held open until `finish()`, like a large one being read. */
function readingFile(name: string) {
	let finish: () => void = () => {};
	const file = {
		name,
		type: 'text/plain',
		arrayBuffer: () =>
			new Promise<ArrayBuffer>((resolve) => (finish = () => resolve(new ArrayBuffer(2)))),
	};
	return { file, finish: () => finish() };
}

/** The open compose window of the app, with `file` dropped on it. */
async function dropOn(app: MailApp, file: ReturnType<typeof readingFile>['file']): Promise<void> {
	await app.updateComplete;
	const compose = inner<Updating>(app, 'mail-compose')!;
	await compose.updateComplete;
	const drop = new Event('drop', { bubbles: true, cancelable: true, composed: true });
	Object.defineProperty(drop, 'dataTransfer', { value: { files: [file], types: ['Files'] } });
	inner(compose, 'section')!.dispatchEvent(drop);
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
		await app.updateComplete;
		const first = app.client;
		expect(first).not.toBeNull();
		// A framework writing its connection inline hands over a new, equal object on every render.
		app.config = { kind: 'demo', seed: { now: Date.UTC(2026, 9, 20) } };
		await app.updateComplete;
		expect(app.client).toBe(first);
		app.config = { kind: 'demo', seed: { now: Date.UTC(2026, 9, 21) } };
		await app.updateComplete;
		expect(app.client).not.toBe(first);
		expect(app.client).not.toBeNull();
	});

	it('starts the connection a host sets as it connects the element, never the demo first', async () => {
		const started = startedWith();
		const given = (): MailConnection => ({
			kind: 'transport',
			transport: testTransport().transport,
		});
		// Set right after connecting it, as a framework does once the element is in the page.
		const app = document.createElement('mail-app') as MailApp;
		document.body.append(app);
		const after = given();
		app.config = after;
		await app.updateComplete;
		// Set before the element is defined: it upgrades with it, as when a framework defines it late.
		const tag = 'mail-app-upgraded';
		const early = document.createElement(tag) as MailApp;
		const before = given();
		early.config = before;
		document.body.append(early);
		customElements.define(tag, class extends MailApp {});
		await early.updateComplete;
		expect(started).toEqual([after, before]);
		expect([app.client, early.client]).not.toContain(null);
		// Taken out and put back, it starts again with the connection it has.
		app.remove();
		document.body.append(app);
		await app.updateComplete;
		expect(started).toEqual([after, before, after]);
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

	it('sends with Ctrl+Enter pressed in an address field, with the address typed there', async () => {
		const { transport, sent } = testTransport();
		const app = await mount({ kind: 'transport', transport });
		const compose = await typeAddress(app, 'bob@example.com');
		const send = key('Enter', { ctrlKey: true });
		inner(inner(compose, 'mail-recipients'), 'input')!.dispatchEvent(send);
		expect(send.defaultPrevented).toBe(true);
		await until(() => sent.length === 1);
		expect(sent[0]!.to).toEqual([{ name: '', email: 'bob@example.com' }]);
	});

	it('waits for the files the compose window is still reading when Escape closes it', async () => {
		const { transport } = testTransport();
		const app = await mount({ kind: 'transport', transport });
		await app.client!.compose('new');
		const { file, finish } = readingFile('notes.txt');
		await dropOn(app, file);
		app.dispatchEvent(key('Escape'));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(state(app).compose).not.toBeNull();
		finish();
		// The file is in the draft; the window stays open while it uploads, as it does for a file
		// added before Escape.
		await until(() => state(app).compose?.draft.attachments.length === 1);
	});

	it('says a file is still uploading when New message or Ctrl+Enter cannot act yet', async () => {
		const base = createMemoryTransport(createDemoSeed({ now: Date.UTC(2026, 9, 20) }));
		let uploaded = (): void => {};
		const sent: Draft[] = [];
		const transport: MailTransport = {
			...base,
			async upload(bytes, type) {
				await new Promise<void>((resolve) => (uploaded = resolve));
				return base.upload(bytes, type);
			},
			send(draft) {
				sent.push(draft);
				return base.send(draft);
			},
		};
		const app = await mount({ kind: 'transport', transport });
		await app.client!.compose('new');
		app.client!.updateDraft({ to: [{ name: '', email: 'bob@example.com' }], subject: 'Hi' });
		const { session } = state(app).compose!;
		const file = { name: 'big.bin', type: '', bytes: new Uint8Array(2) };
		const attaching = app.client!.attach([file]);
		inner<HTMLButtonElement>(app, '.topbar .primary')!.click();
		await until(() => app.toasts.length === 1);
		// The Send button is off while the file uploads; the shortcut says why it does nothing.
		app.dispatchEvent(key('Enter', { ctrlKey: true }));
		await until(() => app.toasts.length === 2);
		await app.updateComplete;
		const toasts = [...app.shadowRoot!.querySelectorAll('.toast > span')];
		expect(toasts.map((toast) => toast.textContent)).toEqual(
			Array.from(
				{ length: 2 },
				() => 'A file is still uploading. Try again once it is in the message.',
			),
		);
		expect(state(app).compose).toMatchObject({ session, uploading: 1 });
		expect(sent).toEqual([]);
		uploaded();
		await attaching;
	});

	it('says in the window and in a notice that an unconfirmed send may have gone out', async () => {
		const base = createMemoryTransport(createDemoSeed({ now: Date.UTC(2026, 9, 20) }));
		const transport: MailTransport = {
			...base,
			send: () => Promise.reject(new MailTransportError('uncertain', 'Not confirmed.')),
		};
		const app = await mount({ kind: 'transport', transport });
		await app.client!.compose('new');
		app.client!.updateDraft({ to: [{ name: '', email: 'bob@example.com' }], subject: 'Hi' });
		expect(await app.client!.send()).toBe(false);
		await until(() => app.toasts.length === 1);
		await app.updateComplete;
		const compose = inner<Updating>(app, 'mail-compose')!;
		await compose.updateComplete;
		const said =
			'The server did not say whether this message was sent. Look in Sent before you change it; sent again unchanged, it goes out only once.';
		expect(inner(compose, '.status')!.textContent).toBe(said);
		const toasts = [...app.shadowRoot!.querySelectorAll('.toast > span')];
		expect(toasts.map((toast) => toast.textContent)).toEqual([said]);
	});

	it('puts the files it is still reading in the draft before another draft takes its place', async () => {
		const { transport, saved } = testTransport();
		const app = await mount({ kind: 'transport', transport });
		await app.client!.compose('new');
		app.client!.updateDraft({ subject: 'With notes' });
		const first = state(app).compose!.session;
		const { file, finish } = readingFile('notes.txt');
		await dropOn(app, file);
		// A reply, a new message or a draft reopened from the list: the window waits for the file.
		const opening = app.client!.compose('new');
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(state(app).compose?.session).toBe(first);
		finish();
		// The draft it was added to is saved with it (the upload is quick here) before the next opens.
		expect(await opening).toBe(true);
		expect(state(app).compose?.session).toBeGreaterThan(first);
		expect(saved.at(-1)).toMatchObject({ subject: 'With notes' });
		expect(saved.at(-1)?.attachments.map((attachment) => attachment.name)).toEqual(['notes.txt']);
	});

	it('puts the files it is still reading in the draft before it lets its connection go', async () => {
		const leaves: [string, (app: MailApp) => void][] = [
			['removed', (app) => app.remove()],
			[
				'reconnected',
				(app) => (app.config = { kind: 'demo', seed: { now: Date.UTC(2026, 9, 20) } }),
			],
		];
		for (const [how, leave] of leaves) {
			const { transport, saved, closed } = testTransport();
			const app = await mount({ kind: 'transport', transport });
			await app.client!.compose('new');
			app.client!.updateDraft({ subject: 'With notes' });
			const { file, finish } = readingFile('notes.txt');
			await dropOn(app, file);
			vi.useFakeTimers();
			try {
				leave(app);
				await vi.advanceTimersByTimeAsync(1_000);
				// The client stays while the file is read, and its draft is saved with it.
				expect(closed(), how).toBe(false);
				finish();
				await vi.advanceTimersByTimeAsync(60_000);
				expect(closed(), how).toBe(true);
				expect(
					saved.at(-1)?.attachments.map((attachment) => attachment.name),
					how,
				).toEqual(['notes.txt']);
			} finally {
				vi.useRealTimers();
			}
		}
	});

	it('ignores what a compose window hands over for a draft that gave way to another', async () => {
		const app = await mount();
		await app.client!.compose('new');
		const gone = state(app).compose!.session;
		await app.client!.compose('new');
		await app.updateComplete;
		const client = app.client!;
		const spies = (['attach', 'closeCompose', 'send', 'discardDraft'] as const).map((name) =>
			vi.spyOn(client, name),
		);
		for (const type of ['attach', 'close', 'send', 'discard'])
			inner(app, 'mail-compose')!.dispatchEvent(
				new CustomEvent(`mail-draft-${type}`, {
					detail: { files: [], session: gone },
					bubbles: true,
					composed: true,
				}),
			);
		for (const spy of spies) expect(spy).not.toHaveBeenCalled();
		expect(state(app).compose?.session).toBeGreaterThan(gone);
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

	it('shows an inline SVG picture from a data: URL, never from a blob: URL of its own', async () => {
		const urls = objectUrls();
		const app = await mount();
		await openWelcome(app);
		await app.updateComplete;
		const reading = inner<Updating>(app, 'mail-reading-pane')!;
		await reading.updateComplete;
		const frame = () => inner<MailHtmlFrame>(reading, 'mail-html-frame');
		await until(() => (frame()?.cidUrls.size ?? 0) > 0);
		// Opened in a tab of its own, an SVG of the app's origin would run its scripts as the app.
		expect(frame()!.cidUrls.get('logo@northwind')).toMatch(/^data:image\/svg\+xml;base64,/);
		expect(urls.made).toEqual([]);
	});

	it('downloads only the pictures a message body shows', async () => {
		const urls = objectUrls();
		const app = await mount();
		const welcome = await openWelcome(app);
		const download = vi.spyOn(app.client!, 'download').mockResolvedValue(new Uint8Array([1, 2]));
		const message = withPictures(
			welcome,
			'pictures',
			'<img src="cid:shown@x"><a href="cid:linked@x">the file</a>',
			'shown@x',
			'linked@x',
			'unused@x',
		);
		expect([...(await app.inlineUrls(message)).keys()]).toEqual(['shown@x']);
		expect(download.mock.calls.map(([part]) => part.cid)).toEqual(['shown@x']);
		expect(urls.made.map((blob) => blob.type)).toEqual(['image/png']);
	});

	it('lets the pictures of older messages go, never those of the open conversation', async () => {
		const urls = objectUrls();
		const app = await mount();
		const welcome = await openWelcome(app);
		await app.inlineUrls(welcome);
		const download = vi.spyOn(app.client!, 'download').mockResolvedValue(new Uint8Array([1, 2]));
		const others = Array.from({ length: 64 }, (_, i) =>
			withPictures(welcome, `other-${i}`, `<img src="cid:p${i}@x">`, `p${i}@x`),
		);
		const first = (await app.inlineUrls(others[0]!)).get('p0@x')!;
		for (const message of others.slice(1)) await app.inlineUrls(message);
		expect(urls.revoked).toContain(first);
		// The open conversation keeps its pictures; a message let go is downloaded again.
		download.mockClear();
		await app.inlineUrls(welcome);
		expect(download).not.toHaveBeenCalled();
		await app.inlineUrls(others[0]!);
		expect(download).toHaveBeenCalledTimes(1);
	});

	it('lets go of what the last mailbox showed when it connects to another', async () => {
		const app = await mount();
		const notes: MailAttachment = {
			partId: '2',
			blobId: 'notes',
			name: 'notes.txt',
			type: 'text/plain',
			size: 5,
			disposition: 'attachment',
			cid: null,
		};
		const download = vi
			.spyOn(app.client!, 'download')
			.mockResolvedValue(new TextEncoder().encode('hello'));
		await app.openAttachment('m1', notes);
		app.notify({ kind: 'done', action: 'archived', count: 1, undo: async () => {} });
		await app.updateComplete;
		expect(inner(app, 'mail-attachment-preview')).not.toBeNull();
		// A download that finishes once the next mailbox is up opens nothing either.
		let finish: (bytes: Uint8Array) => void = () => {};
		download.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
		const late = app.openAttachment('m1', notes);
		app.config = { kind: 'demo', seed: { now: Date.UTC(2026, 9, 21) } };
		await app.updateComplete;
		expect([app.preview, app.toasts]).toEqual([null, []]);
		expect(inner(app, 'mail-attachment-preview')).toBeNull();
		finish(new TextEncoder().encode('late'));
		await late;
		expect(app.preview).toBeNull();
	});

	it('forwards the picture a message shows: in the editor, and by cid: in what it sends', async () => {
		const { transport, sent } = testTransport();
		const app = await mount({ kind: 'transport', transport });
		const welcome = await openWelcome(app);
		await app.client!.compose('forward', welcome.id);
		await app.updateComplete;
		const compose = inner<Updating>(app, 'mail-compose')!;
		await compose.updateComplete;
		const editor = inner<HTMLElement>(compose, '.editor')!;
		const logo = () => editor.querySelector('img[alt="Northwind logo"]');
		await until(() => /^data:image\/svg\+xml;base64,/.test(logo()?.getAttribute('src') ?? ''));
		// It shows in the text, so it is not listed with the files as well.
		await compose.updateComplete;
		expect(inner(compose, '.files')).toBeNull();
		// jsdom has no innerText.
		Object.defineProperty(editor, 'innerText', { get: () => editor.textContent });
		editor.prepend('Have a look. ');
		editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
		const html = state(app).compose!.draft.html!;
		expect(html).toContain('Have a look.');
		expect(html).toMatch(/<img [^>]*src="cid:logo@northwind"/);
		expect(html).not.toMatch(/data:|blob:/);
		app.client!.updateDraft({ to: [{ name: '', email: 'hana@example.com' }] });
		expect(await app.client!.send()).toBe(true);
		expect(sent[0]!.html).toMatch(/<img [^>]*src="cid:logo@northwind"/);
		expect(sent[0]!.attachments).toEqual([
			expect.objectContaining({ cid: 'logo@northwind', inline: true }),
		]);
	});
});
