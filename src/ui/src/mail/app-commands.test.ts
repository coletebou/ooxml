import type { EmailSummary, MailClient, MailState, OpenMessageView } from 'ooxml-core/mail';
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

	it('leaves the keyboard send for later while compose still reads picked files', () => {
		const send = vi.fn(async () => true);
		const mail = {
			getState: () => ({ compose: { uploading: 0 } }),
			send,
		} as unknown as MailClient;
		const reading = { readingFiles: true };
		const busy = {
			view: 'mail',
			renderRoot: {
				querySelector: (selector: string) => (selector === 'mail-compose' ? reading : null),
			},
		} as unknown as MailApp;
		expect(runCommand(busy, mail, 'send')).toBe(true);
		expect(send).not.toHaveBeenCalled();
		reading.readingFiles = false;
		expect(runCommand(busy, mail, 'send')).toBe(true);
		expect(send).toHaveBeenCalledTimes(1);
	});
});
