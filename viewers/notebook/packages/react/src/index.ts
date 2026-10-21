import {
	createElement,
	forwardRef,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react';
import {
	bindNotebook,
	createNotebook,
	defineNotebookApp,
	pickNotebookProps,
	type CreateNotebookOptions,
	type NotebookApp,
	type NotebookBinding,
	type NotebookClient,
	type NotebookProps,
	type NotebookState,
} from 'notebook-viewer';

export type {
	CreateNotebookOptions,
	NotebookApp,
	NotebookClient,
	NotebookClientOptions,
	NotebookExportDetail,
	NotebookNavigateDetail,
	NotebookOpenFileDetail,
	NotebookProps,
	NotebookState,
	NotebookSyncConfig,
	NotebookTheme,
} from 'notebook-viewer';

/** `<Notebook userName="Ada" storageName="ada-notes" onExport={...} />`: the whole app. */
export const Notebook = forwardRef<NotebookApp | null, NotebookProps & { className?: string }>(
	function Notebook({ className, ...props }, ref) {
		const el = useRef<NotebookApp | null>(null);
		const latest = useRef<NotebookProps>(props);
		const binding = useRef<NotebookBinding | null>(null);
		latest.current = props;
		useImperativeHandle(ref, () => el.current as NotebookApp, []);
		// Layout effects run in the commit that connects the element, before its first update (a
		// microtask later), so the element starts its client once, on the storage and user given
		// here, instead of first on the defaults. The class goes through React itself (below), so it
		// also reaches server-rendered markup.
		useLayoutEffect(() => {
			defineNotebookApp();
			if (!el.current) return;
			const bound = bindNotebook(el.current, () => latest.current);
			binding.current = bound;
			return () => {
				bound.destroy();
				binding.current = null;
			};
		}, []);
		// Props are applied after every render; unchanged values are skipped inside the binding.
		useLayoutEffect(() => {
			binding.current?.update(pickNotebookProps(props));
		});
		return createElement('notebook-app', {
			ref: el,
			class: className,
			style: { display: 'block', height: '100%' },
		});
	},
);

/**
 * The raw hook: a core client for `options`, recreated when the user, sync settings, storage or
 * scope change and destroyed (after saving) on unmount. Returns `null` until mounted (and while
 * `options` is `null`).
 *
 *   const client = useNotebookClient({ user: { name: 'Ada' }, storageName: 'ada-notes' });
 *   const state = useNotebookState(client);
 */
export function useNotebookClient(options: CreateNotebookOptions | null): NotebookClient | null {
	const [client, setClient] = useState<NotebookClient | null>(null);
	const key = options
		? JSON.stringify([options.user, options.config, options.storageName, options.scope])
		: '';
	const latest = useRef(options);
	latest.current = options;
	useEffect(() => {
		const opts = latest.current;
		if (!opts) return;
		const created = createNotebook(opts);
		setClient(created);
		return () => {
			void created.destroy();
			setClient(null);
		};
	}, [key]);
	return client;
}

const NO_UNSUBSCRIBE = (): void => {};
/** The current immutable state of a client; re-renders on every change (`useSyncExternalStore`). */
export function useNotebookState(client: NotebookClient | null): NotebookState | null {
	return useSyncExternalStore(
		client ? client.subscribe : () => NO_UNSUBSCRIBE,
		() => (client ? client.getState() : null),
		() => null,
	);
}

/** `useNotebookClient` and `useNotebookState` in one call: `const { client, state } = useNotebook(options)`. */
export function useNotebook(options: CreateNotebookOptions | null): {
	client: NotebookClient | null;
	state: NotebookState | null;
} {
	const client = useNotebookClient(options);
	return { client, state: useNotebookState(client) };
}
