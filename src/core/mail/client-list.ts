// Loading what the client shows: the session, the folders, the message list of a folder or a
// search (newest first, page after page, summaries fetched in batches), and the transport's change
// feed, which refreshes what changed and re-runs the list. A changed message whose summary could
// not be fetched again is fetched by the next list load that holds it, cached or not: the feed has
// moved past the change. Stale responses from an earlier folder or search are dropped by a
// generation counter; a connection that failed is made again on request, one attempt at a time.
// New code.
import type { ClientCore } from './client-core';
import { errorCode } from './client-core';
import { parseSearch } from './search';
import type { MailChange, MailQuery } from './transport';

const BATCH = 500;
const DEFAULT_LIMIT = 2000;
const CHANGE_DELAY_MS = 30;

export interface ListLoader {
	/** Connect (the session, identities, folders, change feed, list); joins an attempt under way. */
	connect(): Promise<void>;
	/** True once a connection worked: until then there is no account and no change feed. */
	connected(): boolean;
	loadMailboxes(): Promise<void>;
	/**
	 * Run the list's folder or search again; with `refetch` (an explicit refresh), fetch the cached
	 * summaries again too, since a change the server did not push shows only then.
	 */
	loadList(options?: { refetch?: boolean }): Promise<void>;
	/** Raise how many messages the list holds and load them. */
	loadMore(): Promise<void>;
	/** Fetch summaries again for ids that changed on the server. */
	refreshEmails(ids: readonly string[]): Promise<void>;
	stop(): void;
}

export function createListLoader(core: ClientCore): ListLoader {
	let generation = 0;
	let limit = core.options.listLimit ?? DEFAULT_LIMIT;
	let unwatch: (() => void) | undefined;
	let pending: MailChange[] = [];
	let flushing: unknown;
	let connected = false;
	let connecting: Promise<void> | undefined;
	/** Cached messages the change feed said changed, whose summaries could not be fetched again. */
	const stale = new Set<string>();

	const query = (): MailQuery => {
		const text = core.state.query;
		const mailboxId = core.listMailboxId();
		return {
			...(text ? parseSearch(text) : {}),
			...(mailboxId ? { mailboxId } : {}),
		};
	};

	const fetchSummaries = async (ids: readonly string[]): Promise<void> => {
		for (let i = 0; i < ids.length; i += BATCH) {
			for (const email of await core.transport.summaries(ids.slice(i, i + BATCH)))
				core.emails.set(email.id, email);
		}
	};

	/**
	 * The first `limit` matches of the list's query, page after page: a server may answer with fewer
	 * than it is asked for (RFC 8620 5.5 lets it cap `limit`), so each page starts where the last one
	 * ended, until the list is full, the matches run out or a page brings nothing new (a transport
	 * that does not page would bring the same ones for ever). Null once a newer load started.
	 */
	const queryList = async (
		current: () => boolean,
	): Promise<{ ids: string[]; total: number } | null> => {
		const listed = query();
		const ids: string[] = [];
		const seen = new Set<string>();
		for (let position = 0; ;) {
			const page = await core.transport.query(listed, { position, limit: limit - ids.length });
			if (!current()) return null;
			const before = ids.length;
			// A message that arrived meanwhile moves the rest down a place: one may come twice.
			for (const id of page.ids) {
				if (seen.has(id)) continue;
				seen.add(id);
				ids.push(id);
			}
			position = page.position + page.ids.length;
			if (ids.length >= limit || position >= page.total || ids.length === before)
				return { ids, total: page.total };
		}
	};

	const loadList = async (options: { refetch?: boolean } = {}): Promise<void> => {
		const mine = ++generation;
		core.patch({ loading: true });
		try {
			const result = await queryList(() => mine === generation && !core.destroyed);
			if (!result) return;
			const ids = options.refetch
				? result.ids
				: result.ids.filter((id) => !core.emails.has(id) || stale.has(id));
			await fetchSummaries(ids);
			for (const id of ids) stale.delete(id);
			if (mine !== generation || core.destroyed) return;
			core.listIds = [...result.ids];
			core.patch({ loading: false, total: result.total });
			core.rebuild();
		} catch (error) {
			if (mine !== generation) return;
			core.patch({ loading: false });
			core.fail('load', error);
			return;
		}
		// A message that joined the open conversation (a reply that just arrived) needs its body.
		if (core.openId) await core.loadBodies(core.openId, false);
	};

	const loadMailboxes = async (): Promise<void> => {
		try {
			core.setMailboxes(await core.transport.mailboxes());
		} catch (error) {
			core.fail('load', error);
		}
	};

	const refreshEmails = async (ids: readonly string[]): Promise<void> => {
		const known = ids.filter((id) => core.emails.has(id));
		if (!known.length) return;
		try {
			await fetchSummaries(known);
			for (const id of known) stale.delete(id);
			core.rebuild();
		} catch (error) {
			for (const id of known) stale.add(id);
			core.fail('load', error);
		}
	};

	const flush = async (): Promise<void> => {
		flushing = undefined;
		const changes = pending;
		pending = [];
		if (core.destroyed) return;
		if (changes.some((change) => change.type === 'reset')) {
			core.emails.clear();
			core.bodies.clear();
			await Promise.all([loadMailboxes(), loadList()]);
			return;
		}
		const jobs: Promise<void>[] = [];
		if (changes.some((change) => change.type === 'mailboxes')) jobs.push(loadMailboxes());
		const updated = new Set<string>();
		for (const change of changes) {
			if (change.type !== 'emails') continue;
			for (const id of change.destroyed) {
				core.emails.delete(id);
				core.bodies.delete(id);
			}
			for (const id of change.updated) updated.add(id);
		}
		if (changes.some((change) => change.type === 'emails')) {
			jobs.push(refreshEmails([...updated]).then(() => loadList()));
		}
		await Promise.all(jobs);
	};

	const onChange = (change: MailChange): void => {
		pending.push(change);
		flushing ??= core.later(() => void flush(), CHANGE_DELAY_MS);
	};

	const connectOnce = async (): Promise<void> => {
		core.patch({ status: 'connecting', error: null });
		try {
			const session = await core.transport.connect();
			if (core.destroyed) return;
			const mailboxes = await core.transport.mailboxes();
			// Destroyed meanwhile: subscribing now would outlive the client.
			if (core.destroyed) return;
			core.setMailboxes(mailboxes);
			const inbox = mailboxes.find((mailbox) => mailbox.role === 'inbox') ?? mailboxes[0];
			core.patch({
				account: session.account,
				identities: session.identities,
				canSend: session.canSend,
				mailboxId: core.state.mailboxId ?? inbox?.id ?? null,
			});
			connected = true;
			unwatch ??= core.transport.watch(onChange);
			await loadList();
			core.patch({ status: 'ready' });
		} catch (error) {
			core.patch({ status: 'error', error: errorCode(error) });
		}
	};

	return {
		connect() {
			connecting ??= connectOnce().finally(() => {
				connecting = undefined;
			});
			return connecting;
		},
		connected: () => connected,
		loadMailboxes,
		loadList,
		async loadMore() {
			limit += core.options.listLimit ?? DEFAULT_LIMIT;
			await loadList();
		},
		refreshEmails,
		stop() {
			unwatch?.();
			unwatch = undefined;
			core.cancel(flushing);
			flushing = undefined;
		},
	};
}
