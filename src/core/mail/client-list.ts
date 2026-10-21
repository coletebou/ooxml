// Loading what the client shows: the session, the folders, the message list of a folder or a
// search (newest first, summaries fetched in batches), and the transport's change feed, which
// refreshes what changed and re-runs the list. Stale responses from an earlier folder or search
// are dropped by a generation counter. New code.
import type { ClientCore } from './client-core';
import { errorCode } from './client-core';
import { parseSearch } from './search';
import type { MailChange, MailQuery } from './transport';

const BATCH = 500;
const DEFAULT_LIMIT = 2000;
const CHANGE_DELAY_MS = 30;

export interface ListLoader {
	connect(): Promise<void>;
	loadMailboxes(): Promise<void>;
	loadList(): Promise<void>;
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

	const loadList = async (): Promise<void> => {
		const mine = ++generation;
		core.patch({ loading: true });
		try {
			const result = await core.transport.query(query(), { position: 0, limit });
			if (mine !== generation || core.destroyed) return;
			await fetchSummaries(result.ids.filter((id) => !core.emails.has(id)));
			if (mine !== generation || core.destroyed) return;
			core.listIds = [...result.ids];
			core.patch({ loading: false, total: result.total });
			core.rebuild();
		} catch (error) {
			if (mine !== generation) return;
			core.patch({ loading: false });
			core.fail('load', error);
		}
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
			core.rebuild();
		} catch (error) {
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
			jobs.push(refreshEmails([...updated]).then(loadList));
		}
		await Promise.all(jobs);
	};

	const onChange = (change: MailChange): void => {
		pending.push(change);
		flushing ??= core.later(() => void flush(), CHANGE_DELAY_MS);
	};

	return {
		async connect() {
			core.patch({ status: 'connecting', error: null });
			try {
				const session = await core.transport.connect();
				if (core.destroyed) return;
				const mailboxes = await core.transport.mailboxes();
				core.setMailboxes(mailboxes);
				const inbox = mailboxes.find((mailbox) => mailbox.role === 'inbox') ?? mailboxes[0];
				core.patch({
					account: session.account,
					identities: session.identities,
					canSend: session.canSend,
					mailboxId: core.state.mailboxId ?? inbox?.id ?? null,
				});
				unwatch ??= core.transport.watch(onChange);
				await loadList();
				core.patch({ status: 'ready' });
			} catch (error) {
				core.patch({ status: 'error', error: errorCode(error) });
			}
		},
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
