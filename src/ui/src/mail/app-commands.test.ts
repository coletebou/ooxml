import {
	createDemoSeed,
	createMailClient,
	createMemoryTransport,
	type EmailSummary,
	type MailClient,
	type MailState,
	type MailTransport,
	type OpenMessageView,
} from 'ooxml-core/mail';
import { committingClient, type ComposeWindow } from './app-client';
import { runCommand } from './app-commands';
import type { MailApp } from './mail-app';

const HOUR = 3_600_000;
const view = (id: string, sentAt: number, depth: number): OpenMessageView => ({
	summary: { id, sentAt, receivedAt: sentAt, keywords: {} } as unknown as EmailSummary,
	depth,
	message: null,
	error: null,
});

/** A client whose state is `state`, recording what compose was asked to answer. */
function client(state: Partial<MailState>) {
	const compose = vi.fn(async () => true);
	const mail = {
		getState: () => ({ selection: [], conversations: [], focusedId: null, ...state }),
		compose,
	} as unknown as MailClient;
	return { mail, compose };
}

const app = { view: 'mail', renderRoot: document.createElement('div') } as unknown as MailApp;

/**
 * `mail`, the demo client (`core`) as `<mail-app>` wraps it, with a draft to Ada open, and `busy`,
 * an app whose compose window is still reading files until `finish()`. `sent` holds the subjects
 * the server was given, `sends` each send asked of `mail`, as it resolves.
 */
async function readingCompose() {
	const base = createMemoryTransport(createDemoSeed({ now: Date.UTC(2026, 9, 20) }));
	const sent: string[] = [];
	const transport: MailTransport = {
		...base,
		send(draft) {
			sent.push(draft.subject);
			return base.send(draft);
		},
	};
	const core = createMailClient({ transport });
	await vi.waitFor(() => expect(core.getState().status).toBe('ready'));
	await core.compose('new');
	core.updateDraft({ to: [{ name: '', email: 'ada@example.com' }], subject: 'Notes' });
	let finish: () => void = () => {};
	const read = new Promise<void>((resolve) => (finish = resolve));
	const reading = { readingFiles: true, filesRead: () => read, commitRecipients: () => {} };
	let shown: ComposeWindow | null = reading;
	const wrapped = committingClient(core, () => shown);
	const sends: Promise<boolean>[] = [];
	const mail: MailClient = {
		...wrapped,
		send() {
			const sending = wrapped.send();
			sends.push(sending);
			return sending;
		},
	};
	const busy = {
		view: 'mail',
		renderRoot: {
			querySelector: (selector: string) => (selector === 'mail-compose' ? shown : null),
		},
	} as unknown as MailApp;
	return {
		core,
		mail,
		busy,
		sent,
		sends,
		/** The window that shows the open draft from now on, or none. */
		show: (window: ComposeWindow | null) => void (shown = window),
		finish: () => {
			reading.readingFiles = false;
			finish();
		},
	};
}

describe('runCommand', () => {
	it('answers the newest message of the open conversation, not the last in thread order', () => {
		// Thread order is depth-first: a, its reply b with b's reply d, then a's later reply c,
		// written before d.
		const { mail, compose } = client({
			open: {
				id: 'a',
				subject: 'Plans',
				messages: [
					view('a', 0, 0),
					view('b', HOUR, 1),
					view('d', 4 * HOUR, 2),
					view('c', 2 * HOUR, 1),
				],
			},
		});
		for (const command of ['reply', 'replyAll', 'forward'] as const)
			expect(runCommand(app, mail, command), command).toBe(true);
		expect(compose.mock.calls).toEqual([
			['reply', 'd'],
			['replyAll', 'd'],
			['forward', 'd'],
		]);
	});

	it('answers the newest message of the focused conversation when none is open', () => {
		// The same thread under the list cursor: its reading order ends with c, its newest is d.
		const conversation = { id: 'a', emailIds: ['a', 'b', 'd', 'c'], latestId: 'd' };
		const { mail, compose } = client({
			open: null,
			focusedId: 'a',
			conversations: [conversation as unknown as MailState['conversations'][number]],
		});
		expect(runCommand(app, mail, 'reply')).toBe(true);
		expect(compose.mock.calls).toEqual([['reply', 'd']]);
	});

	it('sends from the keyboard once the files the compose window still reads are in', async () => {
		const { core, mail, busy, sent, sends, finish } = await readingCompose();
		expect(runCommand(busy, mail, 'send')).toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(sent).toEqual([]);
		finish();
		expect(await Promise.all(sends)).toEqual([true]);
		expect(sent).toEqual(['Notes']);
		core.destroy();
	});

	it('sends nothing from the keyboard once its draft gave way to another meanwhile', async () => {
		const { core, mail, busy, sent, sends, show, finish } = await readingCompose();
		expect(runCommand(busy, mail, 'send')).toBe(true);
		// Before the files are read, the draft is thrown away, its window with it, and another starts.
		await mail.discardDraft();
		show(null);
		await mail.compose('new');
		mail.updateDraft({ to: [{ name: '', email: 'bob@example.com' }], subject: 'Second' });
		finish();
		expect(await Promise.all(sends)).toEqual([false]);
		expect(sent).toEqual([]);
		expect(core.getState().compose?.draft.subject).toBe('Second');
		core.destroy();
	});
});
