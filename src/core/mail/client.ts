// `createMailClient`: the framework-neutral mail client every UI binds to. It works over one
// transport (memory, JMAP, ...), which it closes when destroyed unless the host keeps it, and
// exposes one immutable `MailState` plus plain actions, in the `getState` / `subscribe` shape React
// (`useSyncExternalStore`), Vue, Solid, Svelte and Angular adopt in a few lines. DOM-free: the
// transport, the stores and the timers are injected. New code.
import { ClientCore } from './client-core';
import { createCompose } from './client-compose';
import { createFileActions } from './client-files';
import { createListLoader } from './client-list';
import { createMutations } from './client-mutations';
import { createPeople } from './client-people';
import type { MailClient, MailClientOptions } from './client-types';
import { rangeBetween } from './client-views';
import { SEEN } from './model';

export function createMailClient(options: MailClientOptions): MailClient {
	const core = new ClientCore(options);
	const list = createListLoader(core);
	const { load: loadPeople, ...people } = createPeople(core);
	const { markSeen, ...mutations } = createMutations(core, list);
	const order = (): string[] => core.state.conversations.map((c) => c.id);

	const client: MailClient = {
		getState: () => core.state,
		subscribe: (listener) => core.subscribe(listener),
		onNotice: (listener) => core.notices.on('notice', listener),
		async refresh() {
			// Until a connection works there is no account, identity or change feed to reload with:
			// connect again instead (joining an attempt under way).
			const mail = list.connected()
				? Promise.all([list.loadMailboxes(), list.loadList({ refetch: true })])
				: list.connect();
			await Promise.all([mail, loadPeople()]);
		},
		async selectMailbox(id) {
			if (!core.mailboxes.some((mailbox) => mailbox.id === id)) return;
			core.openId = null;
			core.listIds = [];
			core.patch({ mailboxId: id, query: '', selection: [], focusedId: null, open: null });
			core.rebuild();
			await list.loadList();
		},
		setThreaded(threaded) {
			if (threaded === core.state.threaded) return;
			core.openId = null;
			core.patch({ threaded, selection: [], open: null });
			core.rebuild();
		},
		async search(query) {
			const text = query.trim();
			if (text === core.state.query) return;
			core.openId = null;
			core.patch({ query: text, selection: [], focusedId: null, open: null });
			await list.loadList();
		},
		async setSearchScope(scope) {
			if (scope === core.state.searchScope) return;
			core.patch({ searchScope: scope });
			if (core.state.query) await list.loadList();
		},
		loadMore: () => list.loadMore(),
		select(ids) {
			const known = new Set(order());
			core.patch({ selection: ids.filter((id) => known.has(id)) });
		},
		toggleSelected(id) {
			const selection = core.state.selection.includes(id)
				? core.state.selection.filter((other) => other !== id)
				: [...core.state.selection, id];
			client.select(selection);
			core.patch({ focusedId: id });
		},
		selectRange(id) {
			const range = rangeBetween(order(), core.state.focusedId, id);
			client.select([...new Set([...core.state.selection, ...range])]);
		},
		selectAll: () => client.select(order()),
		clearSelection: () => core.patch({ selection: [] }),
		focus(id) {
			core.patch({ focusedId: id && core.conversationsById.has(id) ? id : null });
		},
		focusNext(step = 1) {
			const ids = order();
			if (!ids.length) return null;
			const at = core.state.focusedId ? ids.indexOf(core.state.focusedId) : -1;
			const next = ids[Math.min(ids.length - 1, Math.max(0, at < 0 ? 0 : at + step))] ?? null;
			core.patch({ focusedId: next });
			return next;
		},
		async open(id) {
			if (!core.conversationsById.has(id)) return;
			core.openId = id;
			core.patch({ focusedId: id });
			core.showOpen();
			const loaded = await core.loadBodies(id, true);
			const conversation = core.conversationsById.get(id);
			if (core.openId === id && conversation && (options.markReadOnOpen ?? true)) {
				// Only what could be read: a message whose body did not load stays unread.
				const unread = conversation.entries
					.filter((e) => !e.email.keywords[SEEN] && loaded.has(e.email.id))
					.map((e) => e.email.id);
				if (unread.length) await markSeen(unread);
			}
		},
		close() {
			core.openId = null;
			core.patch({ open: null });
		},
		...mutations,
		...createCompose(core),
		...createFileActions(core, list),
		...people,
		destroy() {
			list.stop();
			core.destroyed = true;
			// A transport the host keeps stays open for the next client the host gives it to.
			if (options.closeTransport ?? true) core.transport.close();
			core.notices.clear();
		},
	};

	void (async () => {
		await list.connect();
		await loadPeople();
	})();
	return client;
}
