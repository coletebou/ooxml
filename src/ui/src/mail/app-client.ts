// The core client as <mail-app> uses it: an address still being typed in the compose window is part
// of the draft before the window closes, sends or gives way to another, whatever asks the client
// (a key, a link, the host), and a client is let go only once its open draft is saved.
import type { MailClient } from 'ooxml-core/mail';

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

/** Let a client go once its open draft is saved: destroying it first would cut the save off. */
export async function release(client: MailClient): Promise<void> {
	await client.closeCompose().catch(() => false);
	client.destroy();
}
