// The core client as <mail-app> uses it: an address still being typed in the compose window is part
// of the draft before the window closes, sends or gives way to another, whatever asks the client
// (a key, a link, the host), and a client is let go only once its open draft is saved, or once it
// has tried for about a minute to save a draft it could not.
import type { MailClient } from 'ooxml-core/mail';

/** The pauses before each new try to save a released client's draft: four tries in a minute. */
const RETRY_MS = [5_000, 15_000, 40_000];

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
 * Let a client go once its open draft is saved: destroying it first would cut the save off. The
 * first try starts at once, while the window still shows the draft. A draft that cannot be saved
 * (offline, over quota) keeps the client alive in the background, trying again three times over
 * about a minute, and the client is destroyed after the last try whatever its outcome. Nothing
 * waits for this: the next client can start at once.
 */
export async function release(client: MailClient): Promise<void> {
	const close = (): Promise<boolean> => client.closeCompose().catch(() => false);
	let closed = await close();
	for (const pause of RETRY_MS) {
		if (closed) break;
		await new Promise((resolve) => setTimeout(resolve, pause));
		closed = await close();
	}
	client.destroy();
}
