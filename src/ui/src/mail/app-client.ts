// The core client as <mail-app> uses it: the files the compose window is still reading and an
// address still being typed there are part of the draft before the window closes, sends or gives
// way to another, whatever asks the client (a key, a link, the host, the app letting it go), and a
// client is let go only once its open draft is saved: one it cannot save yet keeps trying in the
// background for as long as the page lives.
import type { MailClient } from 'ooxml-core/mail';

/** The pauses before the first new tries to save a released client's draft: four in a minute. */
const RETRY_MS = [5_000, 15_000, 40_000];
/** The pause between the tries after those, for as long as the draft stays unsaved. */
const LATER_MS = 60_000;

/** What a hand-over needs of the compose window that shows the draft (`MailCompose`). */
export interface ComposeWindow {
	/** Picked or dropped files are still being read: they are not in the draft yet. */
	readonly readingFiles: boolean;
	/** Resolves once they are. */
	filesRead(): Promise<void>;
	/** Turn the addresses still being typed into recipients. */
	commitRecipients(): void;
}

/**
 * `client` with each hand-over of the open draft (another draft, Close, Send) made once the window
 * showing it is done with it: the files it is still reading are in the draft, then the addresses
 * still being typed are recipients. `showing` is that window while it shows this client's draft,
 * else null; it is asked at once, so a client released meanwhile still finishes with its own.
 */
export function committingClient(
	client: MailClient,
	showing: () => ComposeWindow | null,
): MailClient {
	const handedOver =
		<A extends unknown[], R>(action: (...args: A) => Promise<R>) =>
		async (...args: A): Promise<R> => {
			const shown = showing();
			if (shown?.readingFiles) await shown.filesRead();
			shown?.commitRecipients();
			return action(...args);
		};
	return {
		...client,
		compose: handedOver(client.compose),
		editDraft: handedOver(client.editDraft),
		closeCompose: handedOver(client.closeCompose),
		send: handedOver(client.send),
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
