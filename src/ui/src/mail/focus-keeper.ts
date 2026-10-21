// Keeps the focus in <mail-app> when one of its updates takes away the element that had it: a
// conversation Escape closed, a row that left the list, the compose window once sent or closed, a
// pane a narrow app hides. The browser would leave the focus on the page, where the app's
// shortcuts no longer hear the keys. New code.
import type { MailState } from 'ooxml-core/mail';

/** Where the focus is in an app: the element with it, and the child of the app's shadow root it is in. */
interface FocusSpot {
	readonly element: HTMLElement;
	readonly part: HTMLElement;
}

/** The panes whose own update can take away what has the focus. */
const PANES =
	'mail-folder-pane, mail-message-list, mail-reading-pane, mail-compose, mail-calendar, mail-contacts';

/**
 * The element with the focus and every shadow host above it, from the document down. Each shadow
 * root asked holds the focus, so none is asked about focus outside it.
 */
function focusChain(doc: Document): HTMLElement[] {
	const chain: HTMLElement[] = [];
	let active: Element | null | undefined = doc.activeElement;
	while (active instanceof HTMLElement) {
		chain.push(active);
		active = active.shadowRoot?.activeElement;
	}
	return chain;
}

/** Where the focus is inside `app` (a shadow host), or null when it is not there. */
function focusSpot(app: HTMLElement): FocusSpot | null {
	const chain = focusChain(app.ownerDocument);
	const at = chain.indexOf(app);
	const part = at < 0 ? undefined : chain[at + 1];
	return part ? { element: chain.at(-1) ?? part, part } : null;
}

/** Whether `el` can have the focus: in the page and shown. */
const usable = (el: HTMLElement): boolean => el.isConnected && el.checkVisibility?.() !== false;

/**
 * When the element of `before` went or hid and nothing else took the focus since, focus the first
 * of `targets` that takes it. A focus moved on purpose (by the person, or by a dialog giving it
 * back) stays where it is.
 */
function keepFocus(
	app: HTMLElement,
	before: FocusSpot,
	targets: readonly (HTMLElement | null | undefined)[],
): void {
	if (usable(before.element)) return;
	const doc = app.ownerDocument;
	const now = focusChain(doc).at(-1);
	if (now && now !== before.element && now !== doc.body && now !== doc.documentElement) return;
	for (const target of targets) {
		if (!target || !usable(target)) continue;
		target.focus();
		if (focusSpot(app)) return;
	}
}

/** The focus of one `<mail-app>` (a shadow host) across its updates. */
export class FocusKeeper {
	/** Where the focus was in the app before the update being drawn. */
	private before: FocusSpot | null = null;
	/** What had the focus when the compose window opened, which gets it back when the window goes. */
	private opener: HTMLElement | null = null;

	constructor(private readonly app: HTMLElement) {}

	/** Before an update: where the focus is. `composeOpens` when the update opens the compose window. */
	note(composeOpens: boolean): void {
		this.before = focusSpot(this.app);
		if (composeOpens) this.opener = this.before?.element ?? null;
	}

	/**
	 * After the update to `state`: when it took away what had the focus, the focus goes somewhere
	 * in the app once the panes have drawn it too.
	 */
	keep(state: MailState | null): void {
		const before = this.before;
		const opener = state?.compose ? null : this.opener;
		this.before = null;
		if (!state?.compose) this.opener = null;
		const root = this.app.shadowRoot;
		if (!before || !root) return;
		const panes = [...root.querySelectorAll<HTMLElement & { updateComplete?: unknown }>(PANES)];
		void Promise.all(panes.map((pane) => pane.updateComplete)).then(() => {
			// The reading pane it was in while that still shows a conversation, what opened the
			// compose window it was in, the list, the reading pane, the current view in the rail.
			const pane = root.querySelector<HTMLElement>('mail-reading-pane');
			const reading = state?.open ? pane : null;
			keepFocus(this.app, before, [
				before.part === pane ? reading : null,
				before.part.localName === 'mail-compose' ? opener : null,
				root.querySelector<HTMLElement>('mail-message-list'),
				reading,
				root.querySelector<HTMLElement>('.rail-item[aria-current="page"]'),
			]);
		});
	}
}
