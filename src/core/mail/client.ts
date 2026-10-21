// `createMailClient`: the framework-neutral mail client every UI binds to. It owns one transport
// (memory, JMAP, ...) and exposes one immutable `MailState` plus plain actions, in the `getState` /
// `subscribe` shape React (`useSyncExternalStore`), Vue, Solid, Svelte and Angular adopt in a few
// lines. DOM-free: the transport, the stores and the timers are injected. New code.
import { ClientCore, errorCode } from './client-core';
import { createCompose } from './client-compose';
import { createFileActions } from './client-files';
import { createListLoader } from './client-list';
import { createMutations } from './client-mutations';
import { createPeople } from './client-people';
import type { MailClient, MailClientOptions } from './client-types';
import { openConversationView, rangeBetween } from './client-views';
import { SEEN } from './model';

export function createMailClient(options: MailClientOptions): MailClient {
	const core = new ClientCore(options);
	const list = createListLoader(core);
	const { load: loadPeople, ...people } = createPeople(core);
	const order = (): string[] => core.state.conversations.map((c) => c.id);

	const showOpen = (): void => {
		const open = core.openId ? core.conversationsById.get(core.openId) : undefined;
		core.patch({ open: open ? openConversationView(open, core.bodies, core.bodyErrors) : null });
	};

	const loadBodies = async (id: string): Promise<void> => {
		const conversation = core.conversationsById.get(id);
		if (!conversation) return;
		await Promise.all(
			conversation.entries
				.filter((entry) => !core.bodies.has(entry.email.id))
				.map(async ({ email }) => {
					try {
						core.keepBody(await core.transport.message(email.id));
					} catch (error) {
						core.bodyErrors.set(email.id, errorCode(error));
					}
					if (core.openId === id) showOpen();
				}),
		);
	};

	const client: MailClient = {
		getState: () => core.state,
		subscribe: (listener) => core.subscribe(listener),
		onNotice: (listener) => core.notices.on('notice', listener),
		async refresh() {
			await Promise.all([list.loadMailboxes(), list.loadList(), loadPeople()]);
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
			showOpen();
			await loadBodies(id);
			const conversation = core.conversationsById.get(id);
			if (core.openId === id && conversation && (options.markReadOnOpen ?? true)) {
				const unread = conversation.entries
					.filter((e) => !e.email.keywords[SEEN])
					.map((e) => e.email.id);
				if (unread.length) await client.markRead(true, unread);
			}
		},
		close() {
			core.openId = null;
			core.patch({ open: null });
		},
		...createMutations(core, list),
		...createCompose(core),
		...createFileActions(core, list),
		...people,
		destroy() {
			list.stop();
			core.destroyed = true;
			core.transport.close();
			core.notices.clear();
		},
	};

	void (async () => {
		await list.connect();
		await loadPeople();
	})();
	return client;
}
