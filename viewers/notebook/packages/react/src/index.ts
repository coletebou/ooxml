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
	notebookNames,
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

// A storage object is told apart by identity: another one means another client.
const identities = new WeakMap<object, number>();
let lastIdentity = 0;
function identity(value: object | undefined): number {
	if (!value) return 0;
	let id = identities.get(value);
	if (id === undefined) identities.set(value, (id = ++lastIdentity));
	return id;
}

/**
 * The raw hook: a core client for `options`, recreated when the user, sync settings, storage or
 * scope change and destroyed (after saving) on unmount. Returns `null` until mounted (and while
 * `options` is `null`).
 *
 *   const client = useNotebookClient({ user: { name: 'Ada' }, storageName: 'ada-notes' });
 *   const state = useNotebookState(client);
 */
export function useNotebookClient(options: CreateNotebookOptions | null): NotebookClient | null {
	const [made, setMade] = useState<{ key: string; client: NotebookClient } | null>(null);
	const key = options
		? JSON.stringify([
				options.user,
				options.config,
				options.storageName,
				options.scope,
				identity(options.storage),
			])
		: '';
	const latest = useRef(options);
	latest.current = options;
	useEffect(() => {
		const opts = latest.current;
		if (!opts) return;
		const created = createNotebook(opts);
		setMade({ key, client: created });
		return () => {
			void created.destroy();
			setMade(null);
		};
	}, [key]);
	// During the render that changes the options the old client is still in state; it belongs to
	// the old options (another profile's notebooks, perhaps), so it is not handed out.
	const client = made?.key === key ? made.client : null;
	// A language change renames what is created next; the client (and its notebooks) stays.
	const locale = options?.locale;
	useEffect(() => {
		client?.setNames(notebookNames(locale));
	}, [client, locale]);
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
