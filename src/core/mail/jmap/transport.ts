// `createJmapTransport`: the `MailTransport` of a JMAP server (RFC 8620, RFC 8621), assembled from
// the session client, the mailbox, message, draft and blob methods, and the change tracker and
// watcher behind `watch`. New code.
import type { Identity } from '../model';
import { MailTransportError, type MailChange, type MailTransport } from '../transport';
import { createBlobMethods } from './blobs';
import { createChangeTracker } from './changes';
import { createJmapClient } from './client';
import { objects, toIdentity } from './convert';
import { createDraftMethods } from './drafts';
import { createEmailMethods } from './emails';
import type { JmapAuth } from './http';
import { createMailboxMethods } from './mailboxes';
import type { Timers } from './push';
import { accountHas } from './session';
import { SUBMISSION } from './types';
import { createWatcher, type PushMode } from './watch';

export interface JmapTransportOptions {
	/** The server origin (discovery through `/.well-known/jmap`, RFC 8620 2.2) or the session URL. */
	url: string;
	auth: JmapAuth;
	/** Default `globalThis.fetch`. */
	fetch?: typeof fetch;
	/** Default: `primaryAccounts['urn:ietf:params:jmap:mail']`. */
	accountId?: string;
	/** `auto`: event source push when the session offers it, else polling; `poll`; `off`. */
	push?: PushMode;
	/** Default 60000. */
	pollIntervalMs?: number;
	/** Timers, injectable for tests. */
	setTimeout?: typeof setTimeout;
	clearTimeout?: typeof clearTimeout;
}

export const DEFAULT_POLL_INTERVAL_MS = 60_000;

/** Identity/get errors that mean "this account cannot send", not "the call failed". */
const NO_IDENTITIES = new Set(['forbidden', 'accountNotSupportedByMethod', 'unknownMethod']);

export function createJmapTransport(options: JmapTransportOptions): MailTransport {
	const lifetime = new AbortController();
	const client = createJmapClient({
		url: options.url,
		auth: options.auth,
		...(options.fetch ? { fetch: options.fetch } : {}),
		...(options.accountId === undefined ? {} : { accountId: options.accountId }),
		signal: lifetime.signal,
		// Every request is made after the tracker below exists.
		onResponse: (response) => tracker.wrote(response),
	});
	const timers: Timers = {
		setTimeout: (callback, ms) => (options.setTimeout ?? globalThis.setTimeout)(callback, ms),
		clearTimeout: (handle) =>
			(options.clearTimeout ?? globalThis.clearTimeout)(handle as ReturnType<typeof setTimeout>),
	};
	const listeners = new Set<(change: MailChange) => void>();
	let closed = false;
	let identities: Promise<Identity[]> | null = null;

	const emit = (change: MailChange): void => {
		for (const listener of [...listeners]) {
			try {
				listener(change);
			} catch (error) {
				// One listener's failure must not stop the others; it still surfaces as uncaught.
				queueMicrotask(() => {
					throw error;
				});
			}
		}
	};
	const tracker = createChangeTracker(client, emit, () => mailboxes.forgetRoles());
	const nudge = (): void => void tracker.sync();
	const mailboxes = createMailboxMethods(client, tracker, nudge);
	const emails = createEmailMethods(client, tracker, nudge);
	const blobs = createBlobMethods(client, nudge);

	const sendable = async (): Promise<boolean> => {
		const session = await client.session();
		const accountId = client.accountId();
		return (
			accountHas(session, accountId, SUBMISSION) && session.accounts[accountId]?.isReadOnly !== true
		);
	};

	const loadIdentities = async (signal?: AbortSignal): Promise<Identity[]> => {
		if (!(await sendable())) return [];
		const { result, calls } = await client.request(
			(builder, accountId) => builder.call('Identity/get', { accountId }),
			signal,
		);
		const error = result.error(calls);
		if (error && NO_IDENTITIES.has(error.type)) return [];
		return objects(result.get(calls).list).map(toIdentity);
	};

	/** Keeps a load of the identities, unless it fails. */
	const remember = (pending: Promise<Identity[]>): Promise<Identity[]> => {
		identities = pending;
		pending.catch(() => {
			if (identities === pending) identities = null;
		});
		return pending;
	};

	const drafts = createDraftMethods({
		client,
		mailboxes,
		identities: () => identities ?? remember(loadIdentities()),
		canSend: sendable,
		nudge,
	});
	const pollIntervalMs =
		options.pollIntervalMs !== undefined && options.pollIntervalMs > 0
			? options.pollIntervalMs
			: DEFAULT_POLL_INTERVAL_MS;
	const watcher = createWatcher({
		client,
		tracker,
		timers,
		mode: options.push ?? 'auto',
		pollIntervalMs,
	});

	const closedError = (): MailTransportError =>
		new MailTransportError('network', 'The transport is closed.');
	const open =
		<A extends unknown[], R>(method: (...args: A) => Promise<R>) =>
		(...args: A): Promise<R> =>
			closed ? Promise.reject(closedError()) : method(...args);

	return {
		kind: 'jmap',
		connect: open(async (signal?: AbortSignal) => {
			const session = await client.connect(signal);
			const accountId = client.accountId();
			const list = await remember(loadIdentities(signal));
			return {
				account: { id: accountId, name: session.accounts[accountId]?.name ?? accountId },
				...(session.username ? { user: session.username } : {}),
				identities: list,
				canSend: list.length > 0,
			};
		}),
		mailboxes: open(mailboxes.mailboxes),
		createMailbox: open(mailboxes.createMailbox),
		renameMailbox: open(mailboxes.renameMailbox),
		destroyMailbox: open(mailboxes.destroyMailbox),
		query: open(emails.query),
		summaries: open(emails.summaries),
		message: open(emails.message),
		update: open(emails.update),
		destroy: open(emails.destroy),
		saveDraft: open(drafts.saveDraft),
		send: open(drafts.send),
		upload: open(blobs.upload),
		download: open(blobs.download),
		importMessage: open(blobs.importMessage),
		watch(listener) {
			if (closed) return () => {};
			const idle = listeners.size === 0;
			listeners.add(listener);
			if (idle) watcher.start();
			let subscribed = true;
			return () => {
				if (!subscribed) return;
				subscribed = false;
				listeners.delete(listener);
				if (listeners.size === 0 && !closed) watcher.stop();
			};
		},
		close() {
			if (closed) return;
			closed = true;
			listeners.clear();
			watcher.stop();
			lifetime.abort(closedError());
		},
	};
}
