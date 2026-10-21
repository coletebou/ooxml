// The core client as <mail-app> uses it: an address still being typed in the compose window is part
// of the draft before the window closes, sends or gives way to another, whatever asks the client
// (a key, a link, the host), and a client is let go only once its open draft is saved: one it
// cannot save yet keeps trying in the background for as long as the page lives.
import type { MailClient } from 'ooxml-core/mail';

/** The pauses before the first new tries to save a released client's draft: four in a minute. */
const RETRY_MS = [5_000, 15_000, 40_000];
/** The pause between the tries after those, for as long as the draft stays unsaved. */
const LATER_MS = 60_000;

/** `client` with `commit` (turning typed addresses into recipients) run before each hand-over. */
export function committingClient(client: MailClient, commit: () => void): MailClient {
	const committed =
		<A extends unknown[], R>(action: (...args: A) => R) =>
		(...args: A): R => {
			commit();
			return action(...args);
		};
	return {
		...client,
		compose: committed(client.compose),
		editDraft: committed(client.editDraft),
		closeCompose: committed(client.closeCompose),
		send: committed(client.send),
	};
}

/**
 * Let a client go once its open draft is saved: destroying it first would cut the save off, and
 * nobody else holds the draft. The first try starts at once, while the window still shows the
 * draft. A draft that cannot be saved (offline, over quota) keeps the client alive in the
 * background, trying again after 5, 15 and 40 seconds and then once a minute, and the client is
 * destroyed only once a try succeeds. Nothing waits for this: the next client can start at once.
 */
export async function release(client: MailClient): Promise<void> {
	const close = (): Promise<boolean> => client.closeCompose().catch(() => false);
	for (let tries = 0; !(await close()); tries++) {
		const pause = RETRY_MS[tries] ?? LATER_MS;
		await new Promise((resolve) => setTimeout(resolve, pause));
	}
	client.destroy();
}
