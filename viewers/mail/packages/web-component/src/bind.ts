// The element wiring every framework binding repeats, written once: props in (`applyMailProps`,
// plus the host class), events out (`listenMailEvents`) and the bookkeeping of what was applied.
import { applyMailProps, listenMailEvents, type MailApp, type MailProps } from 'ooxml-ui/mail';

/** The props of `<mail-app>` plus the class list of its host element. */
export type MailElementProps = MailProps & { className?: string | undefined };

const KEYS = ['config', 'locale', 'theme', 'view'] as const;

/**
 * Copies the defined, shared props out of a framework's props object. `undefined` means "not
 * provided"; `config` keeps an explicit `null`. Handlers are not copied: events go through the
 * `get` callback of `bindMail`.
 */
export function pickMailProps(
	source: { [K in (typeof KEYS)[number]]?: MailProps[K] | undefined } & {
		className?: string | undefined;
	},
): MailElementProps {
	const picked: Record<string, unknown> = {};
	for (const key of KEYS) if (source[key] !== undefined) picked[key] = source[key];
	if (source.className) picked.className = source.className;
	return picked as MailElementProps;
}

export interface MailBinding {
	/** Apply props; only values that changed since the last call are written. */
	update(next: MailElementProps): void;
	/** Stop listening for events. The element is left to the framework that owns it. */
	destroy(): void;
}

const tokens = (value: string | undefined): string[] => value?.split(/\s+/).filter(Boolean) ?? [];

/**
 * Wires `el` to a framework's props: `update` pushes changed props (and the host class), and the
 * element's events call the handlers returned by `get` at event time.
 */
export function bindMail(el: MailApp, get: () => MailElementProps): MailBinding {
	let applied: MailElementProps = {};
	const stop = listenMailEvents(el, get);
	return {
		update(next) {
			applyMailProps(el, next, applied);
			if (next.className !== applied.className) {
				el.classList.remove(...tokens(applied.className));
				el.classList.add(...tokens(next.className));
			}
			applied = next;
		},
		destroy: stop,
	};
}
