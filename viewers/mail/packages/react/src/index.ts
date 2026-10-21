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
	bindMail,
	createMail,
	defineMailApp,
	pickMailProps,
	releaseMailClient,
	sameMailConnection,
	type MailApp,
	type MailBinding,
	type MailClient,
	type MailConnection,
	type MailOptions,
	type MailProps,
	type MailState,
} from 'mail-viewer';

export type {
	MailClient,
	MailConnection,
	MailOptions,
	MailProps,
	MailState,
	OpenAttachmentDetail,
} from 'mail-viewer';

/** `<Mail config={...} locale="de" onNotice={...} />`: the whole app (give it a height). */
export const Mail = forwardRef<MailApp | null, MailProps & { className?: string }>(function Mail(
	{ className, ...props },
	ref,
) {
	const el = useRef<MailApp | null>(null);
	const latest = useRef<MailProps>(props);
	const binding = useRef<MailBinding | null>(null);
	latest.current = props;
	useImperativeHandle(ref, () => el.current as MailApp, []);
	// Three layout effects, in this order: bind the element, give it its props, define it. They run
	// before the browser paints and before the element's first update, which starts its client, so
	// it starts with the connection it was given and never shows the demo mailbox first, even when
	// it is defined only here and upgrades with its props already set.
	useLayoutEffect(() => {
		if (!el.current) return;
		const bound = bindMail(el.current, () => latest.current);
		binding.current = bound;
		return () => {
			bound.destroy();
			binding.current = null;
		};
	}, []);
	// Props are applied after every render; unchanged values are skipped inside the binding. The
	// class goes through React itself (below), so it also reaches server-rendered markup.
	useLayoutEffect(() => {
		binding.current?.update(pickMailProps(props));
	});
	useLayoutEffect(() => {
		defineMailApp();
	}, []);
	return createElement('mail-app', {
		ref: el,
		class: className,
		style: { display: 'block', height: '100%' },
	});
});

/** The client of an effect run that was cleaned up, while its release waits a moment. */
interface Leaving {
	client: MailClient;
	config: MailConnection | undefined;
	/** Call the release off: the effect ran again at once with the same connection. */
	keep(): void;
}

/**
 * The raw hook: a core mail client for `options`, recreated when the connection changes and
 * destroyed on unmount (StrictMode's replay of the effect keeps it). Returns `null` until mounted
 * (and while `options` is `null`).
 *
 *   const client = useMailClient({ config: { kind: 'jmap', url, auth } });
 *   const state = useMailState(client);
 */
export function useMailClient(options: MailOptions | null): MailClient | null {
	const [client, setClient] = useState<MailClient | null>(null);
	const latest = useRef(options);
	latest.current = options;
	// The connection is compared by value, so an inline `config` (a new object on every render)
	// keeps the client; credentials are compared, never made part of a string key.
	const connection = useRef(options?.config);
	if (!sameMailConnection(connection.current, options?.config))
		connection.current = options?.config;
	const config = connection.current;
	const leaving = useRef<Leaving | null>(null);
	useEffect(() => {
		const opts = latest.current;
		const last = leaving.current;
		leaving.current = null;
		if (!opts) return;
		// StrictMode runs the cleanup and the effect again at once: the same connection keeps its
		// client, whose release (closing the host's transport) is called off.
		const kept = last && sameMailConnection(last.config, opts.config) ? last : null;
		kept?.keep();
		const created = kept?.client ?? createMail(opts);
		setClient(created);
		return () => {
			// The open draft is saved (retried until it is) before the client goes.
			const release = setTimeout(() => {
				if (leaving.current?.client === created) leaving.current = null;
				void releaseMailClient(created);
			});
			leaving.current = { client: created, config: opts.config, keep: () => clearTimeout(release) };
			setClient(null);
		};
	}, [options === null, config]);
	return client;
}

const NO_UNSUBSCRIBE = (): void => {};
/** The current immutable state of a client; re-renders on every change (`useSyncExternalStore`). */
export function useMailState(client: MailClient | null): MailState | null {
	return useSyncExternalStore(
		client ? client.subscribe : () => NO_UNSUBSCRIBE,
		() => (client ? client.getState() : null),
		() => null,
	);
}

/** `useMailClient` and `useMailState` in one call: `const { client, state } = useMail(options)`. */
export function useMail(options: MailOptions | null): {
	client: MailClient | null;
	state: MailState | null;
} {
	const client = useMailClient(options);
	return { client, state: useMailState(client) };
}
