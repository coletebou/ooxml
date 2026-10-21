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
	useLayoutEffect(() => {
		defineMailApp();
	}, []);
	useEffect(() => {
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
	useEffect(() => {
		binding.current?.update(pickMailProps(props));
	});
	return createElement('mail-app', {
		ref: el,
		class: className,
		style: { display: 'block', height: '100%' },
	});
});

/**
 * The raw hook: a core mail client for `options`, recreated when the connection changes and
 * destroyed on unmount. Returns `null` until mounted (and while `options` is `null`).
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
	useEffect(() => {
		const opts = latest.current;
		if (!opts) return;
		const created = createMail(opts);
		setClient(created);
		return () => {
			// The open draft is saved (retried until it is) before the client goes.
			void releaseMailClient(created);
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
