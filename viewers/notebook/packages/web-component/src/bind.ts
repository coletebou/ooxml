// The element wiring every framework binding repeats, written once: props in
// (`applyNotebookProps`, plus the host class), events out (`listenNotebookEvents`) and the
// bookkeeping of what was applied. It lives here, on top of the published `ooxml-ui/notebook`
// contract, so a binding works with the last released ooxml-ui; it can move into ooxml-ui once
// that is released with it.
import {
	applyNotebookProps,
	listenNotebookEvents,
	type NotebookApp,
	type NotebookProps,
} from 'ooxml-ui/notebook';

/** The props of `<notebook-app>` plus the class list of its host element. */
export type NotebookElementProps = NotebookProps & { className?: string | undefined };

/** The event handlers of `NotebookProps`; every other prop is data the element receives. */
type HandlerKey = 'onReady' | 'onNavigate' | 'onOpenFile' | 'onExport';
type DataKey = Exclude<keyof NotebookProps, HandlerKey>;

const KEYS = [
	'userName',
	'userId',
	'locale',
	'config',
	'storageName',
	'theme',
] as const satisfies readonly DataKey[];

/**
 * Copies the defined data props out of a framework's props/instance object. `undefined` means
 * "not provided"; `config` keeps an explicit `null`. Handlers are not copied: events go through
 * the `get` callback of `bindNotebook`.
 */
export function pickNotebookProps(
	source: { [K in DataKey]?: NotebookProps[K] | undefined } & { className?: string | undefined },
): NotebookElementProps {
	const picked: Record<string, unknown> = {};
	for (const key of KEYS) if (source[key] !== undefined) picked[key] = source[key];
	if (source.className) picked.className = source.className;
	return picked as NotebookElementProps;
}

export interface NotebookBinding {
	/** Apply props; only values that changed since the last call are written. */
	update(next: NotebookElementProps): void;
	/** Stop listening for events. The element is left to the framework that owns it. */
	destroy(): void;
}

const tokens = (value: string | undefined): string[] => value?.split(/\s+/).filter(Boolean) ?? [];

/**
 * Wires `el` to a framework's props: `update` pushes changed props (and the host class), and the
 * element's events call the handlers returned by `get` at event time. Call the first `update`
 * before the element's first update (in the same task that connects it), so it starts its client
 * once, on the storage and user the host asked for.
 */
export function bindNotebook(el: NotebookApp, get: () => NotebookElementProps): NotebookBinding {
	let applied: NotebookElementProps = {};
	const stop = listenNotebookEvents(el, get);
	return {
		update(next) {
			applyNotebookProps(el, next, applied);
			if (next.className !== applied.className) {
				el.classList.remove(...tokens(applied.className));
				el.classList.add(...tokens(next.className));
			}
			applied = next;
		},
		destroy: stop,
	};
}
