// @vitest-environment jsdom
import { render } from 'lit';
import {
	createDemoSeed,
	createMailClient,
	createMemoryTransport,
	type MailClient,
} from 'ooxml-core/mail';
import { composeView } from './app-compose-view';
import { defineMailCompose, type MailCompose } from './compose';

type Updating = HTMLElement & { updateComplete: Promise<boolean> };

beforeAll(() => defineMailCompose());
afterEach(() => {
	document.body.replaceChildren();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

/** The demo mailbox's client, connected. */
async function connected(): Promise<MailClient> {
	const mail = createMailClient({
		transport: createMemoryTransport(createDemoSeed({ now: Date.UTC(2026, 9, 20) })),
	});
	await vi.waitFor(() => expect(mail.getState().status).toBe('ready'));
	return mail;
}

/** The compose layer as `<mail-app>` draws it, drawn again each time the client's state changes. */
function composeLayer(mail: MailClient) {
	const host = document.createElement('div');
	document.body.append(host);
	const draw = (): void => void render(composeView(mail, mail.getState()), host);
	draw();
	const stop = mail.subscribe(draw);
	return { shown: () => host.querySelector<MailCompose>('mail-compose'), stop };
}

/** The input of the To field of `compose`, once it is drawn. */
async function toInput(compose: MailCompose): Promise<HTMLInputElement> {
	await compose.updateComplete;
	const to = compose.shadowRoot!.querySelector<Updating>('mail-recipients')!;
	await to.updateComplete;
	return to.shadowRoot!.querySelector('input')!;
}

describe('composeView', () => {
	it('keeps an address typed in a window thrown away out of the draft opened next', async () => {
		const mail = await connected();
		const { shown, stop } = composeLayer(mail);
		await mail.compose('new');
		await vi.waitFor(() => expect(shown()).not.toBeNull());
		const first = shown()!;
		const input = await toInput(first);
		vi.useFakeTimers();
		input.value = 'carol@example.com';
		input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
		// Discard takes the focus from the field, which turns what it holds into an address a moment
		// later; before then, the window is gone and another draft open.
		input.dispatchEvent(new Event('blur'));
		first.shadowRoot!.querySelector<HTMLButtonElement>('[aria-label="Discard the draft"]')!.click();
		await vi.advanceTimersByTimeAsync(0);
		expect(shown()).toBeNull();
		expect(await mail.compose('new')).toBe(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(shown()).not.toBe(first);
		const { session } = mail.getState().compose!;
		await vi.advanceTimersByTimeAsync(1_000);
		expect(mail.getState().compose).toMatchObject({ session, draft: { to: [] } });
		stop();
		mail.destroy();
	});

	it('applies the changes a window names for the open draft, and no others', async () => {
		const mail = await connected();
		const { shown, stop } = composeLayer(mail);
		await mail.compose('new');
		const gone = mail.getState().compose!.session;
		await mail.compose('new');
		await vi.waitFor(() => expect(shown()).not.toBeNull());
		const open = mail.getState().compose!.session;
		const updateDraft = vi.spyOn(mail, 'updateDraft');
		const detach = vi.spyOn(mail, 'detach');
		const fire = (type: string, session: number): void =>
			void shown()!.dispatchEvent(
				new CustomEvent(`mail-draft-${type}`, {
					detail: { patch: { subject: 'Late' }, blobId: 'b1', session },
					bubbles: true,
					composed: true,
				}),
			);
		for (const type of ['change', 'detach']) fire(type, gone);
		expect([updateDraft.mock.calls, detach.mock.calls]).toEqual([[], []]);
		for (const type of ['change', 'detach']) fire(type, open);
		expect([updateDraft.mock.calls, detach.mock.calls]).toEqual([
			[[{ subject: 'Late' }]],
			[['b1']],
		]);
		stop();
		mail.destroy();
	});
});
