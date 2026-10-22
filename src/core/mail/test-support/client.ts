// Helpers for mail client tests: wait for a state, and hold a transport call back until the test
// lets it go, so a test can act while a save or an upload is on its way.
import type { MailClient, MailState } from '../client-types';

/** Waits until `test` holds for the client's state, checking every few milliseconds. */
export async function until(
	client: MailClient,
	test: (state: MailState) => boolean,
): Promise<MailState> {
	for (let i = 0; i < 200; i++) {
		if (test(client.getState())) return client.getState();
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`state never matched: ${JSON.stringify(client.getState().status)}`);
}

/** Holds back every call to `pass` made while `holding` is set, until `release`. */
export function createGate() {
	const waiting: (() => void)[] = [];
	const gate = {
		holding: false,
		pass: async (): Promise<void> => {
			if (gate.holding) await new Promise<void>((resolve) => waiting.push(resolve));
		},
		release: (): void => {
			gate.holding = false;
			for (const resume of waiting.splice(0)) resume();
		},
	};
	return gate;
}
