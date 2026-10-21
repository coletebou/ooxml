// The modal dialogs of the mail app (the event dialog, the shortcuts list, the attachment preview):
// the focus moves in when one opens and back to what had it when it closes, Tab and Shift+Tab go
// round its controls (also those inside the shadow roots of a viewer it shows), Escape closes it,
// and the app's shortcuts never see its keys. New code.

/** The element with the focus, looked up through open shadow roots; null when there is none. */
export function deepActiveElement(root: DocumentOrShadowRoot): HTMLElement | null {
	let active = root.activeElement;
	while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
	return active instanceof HTMLElement ? active : null;
}

/** Whether Tab stops at `el` (layout is only known where the browser can tell). */
const isTabStop = (el: HTMLElement): boolean =>
	el.tabIndex >= 0 &&
	!el.matches(':disabled') &&
	!(el instanceof HTMLInputElement && el.type === 'hidden') &&
	el.checkVisibility?.() !== false;

/** The elements Tab stops at inside `root`, in order, through open shadow roots and slots. */
export function tabStops(root: ParentNode): HTMLElement[] {
	const stops: HTMLElement[] = [];
	const visit = (elements: Iterable<Element>): void => {
		for (const el of elements) {
			if (!(el instanceof HTMLElement) || el.hidden || el.inert) continue;
			if (isTabStop(el)) stops.push(el);
			if (el.shadowRoot) visit(el.shadowRoot.children);
			else if (el instanceof HTMLSlotElement) {
				const assigned = el.assignedElements({ flatten: true });
				visit(assigned.length ? assigned : el.children);
			} else visit(el.children);
		}
	};
	visit(root.children);
	return stops;
}

/** Focus the first control of a dialog that just opened. */
export function focusFirst(dialog: ParentNode | null): void {
	if (dialog) tabStops(dialog)[0]?.focus();
}

/**
 * The keydown listener of a modal dialog: Escape closes it, Tab and Shift+Tab wrap round its
 * controls, and no key reaches the app's shortcuts. A key a control inside handled stays handled.
 */
export function trapKeys(event: KeyboardEvent, close: () => void): void {
	event.stopPropagation();
	if (event.defaultPrevented) return;
	if (event.key === 'Escape') {
		event.preventDefault();
		close();
		return;
	}
	if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
	const stops = tabStops(event.currentTarget as HTMLElement);
	// The control the key was pressed in, inside a viewer's shadow root too.
	const from = event.composedPath()[0] as HTMLElement;
	const edge = event.shiftKey ? stops[0] : stops.at(-1);
	// Between two controls Tab works as usual; past the last one (or from outside them) it wraps.
	if (from !== edge && stops.includes(from)) return;
	event.preventDefault();
	(event.shiftKey ? stops.at(-1) : stops[0])?.focus();
}

/** What had the focus before a dialog opened, given back when it closes. */
export class FocusReturn {
	private opener: HTMLElement | null = null;

	/** Remember what has the focus now (inside `root`). */
	take(root: DocumentOrShadowRoot): void {
		this.opener = deepActiveElement(root);
	}

	/** Focus it again, when it is still on the page. */
	restore(): void {
		const opener = this.opener;
		this.opener = null;
		if (opener?.isConnected) opener.focus();
	}
}
