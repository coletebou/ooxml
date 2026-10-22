// Locale inheritance shared by the product elements. An app element (`<teams-app locale="de">`,
// `<mail-app locale="de">`) sets its own locale and hands it to every product element in its shadow
// tree: an element takes the nearest ancestor's locale when it connects, and a host pushes a change
// down to the elements it rendered. An element given its own locale keeps it: a locale written on
// the element by anything but this inheritance (its template, its page, a script) is its own, even
// one equal to the inherited locale, until it is cleared (''), when the element follows again.
// Extracted from `teams/i18n/runtime.ts`. Both symbols are registry keys (the host one keeps its
// original key), so mixed builds still agree.

export const LOCALE_HOST = Symbol.for('ooxml-ui.teams.locale-host');

/**
 * Where an element's locale came from, kept on the element so that every build on a page reads the
 * same mark: `own` once anything but inheritance wrote it, `handing` while inheritance writes it.
 * An element without the mark (one that only ever inherited, or one of a build that never marks
 * its own) follows its host.
 */
const SOURCE = Symbol.for('ooxml-ui.locale-source');

/** An element that has a `locale` and takes part in locale inheritance. */
export interface LocaleHost extends HTMLElement {
	locale: string;
	readonly [LOCALE_HOST]: true;
	readonly renderRoot: HTMLElement | DocumentFragment;
}

type Marked = LocaleHost & { [SOURCE]?: 'own' | 'handing' };

const isHost = (node: Node | null): node is LocaleHost =>
	node !== null && (node as unknown as Record<symbol, unknown>)[LOCALE_HOST] === true;

/** The closest ancestor that is a locale host, looking out of shadow roots. */
function ancestorHost(el: Node): LocaleHost | null {
	let node: Node | null = el;
	while (node) {
		const next: Node | null = node.parentNode ?? (node as ShadowRoot).host ?? null;
		if (isHost(next)) return next;
		node = next;
	}
	return null;
}

/** Whether `el` takes its locale from its host: it has none of its own. */
const follows = (el: Marked): boolean => !el.locale || el[SOURCE] !== 'own';

/** Write an inherited locale, marked as such for `localeWritten`. */
function handDown(el: Marked, locale: string): void {
	el[SOURCE] = 'handing';
	try {
		if (el.locale !== locale) el.locale = locale;
	} finally {
		delete el[SOURCE];
	}
}

/**
 * Take the nearest ancestor's locale (none when there is none), unless this element has one of its
 * own. Its element calls this when it connects, so an element moved under another host follows that
 * host, and before an update in which its locale was cleared, so it takes the enclosing one again.
 */
export function inheritLocale(el: LocaleHost): void {
	if (follows(el)) handDown(el, ancestorHost(el)?.locale ?? '');
}

/**
 * Hand a changed locale on to the locale hosts this element rendered that have none of their own:
 * each takes the locale of its nearest host again.
 */
export function pushLocale(host: LocaleHost): void {
	for (const child of host.renderRoot.querySelectorAll('*'))
		if (isHost(child)) inheritLocale(child);
}

/**
 * Note that `el.locale` was just written. Its element calls this from `requestUpdate`, for every
 * write, so a locale set on it by anything but inheritance becomes its own.
 */
export function localeWritten(el: LocaleHost): void {
	const marked = el as Marked;
	if (marked[SOURCE] !== 'handing') marked[SOURCE] = 'own';
}
