// The navigation pane's requests: select, rename, add, delete (with Undo), move by keyboard or
// drag and drop, and the item menus. Plain functions over the app host.
import type { AppHost } from './app-host';
import { exportNotebook, exportPage } from './app-actions';
import {
	type MenuContext,
	notebookMenu,
	pageMenu,
	pageNeighbour,
	sectionMenu,
	sectionNeighbour,
} from './menus';
import type { NavItemKind } from './nav-pane';

export function menuContext(app: AppHost): MenuContext | null {
	if (!app.client || !app.state) return null;
	return {
		client: app.client,
		state: app.state,
		t: (key, params) => app.tr(key, params),
		rename: (kind, id) => app.nav()?.startRename(kind, id),
		deleted: (kind, batch, id) => app.noticeDeleted(kind, batch, id),
	};
}

export function addSection(app: AppHost, kind: 'section' | 'group'): void {
	const id = app.client?.createSection({ kind });
	if (!id) return;
	app.navOpen = true;
	void app.updateComplete.then(() => app.nav()?.startRename(kind, id));
}

export function addPage(app: AppHost, subpage = false): void {
	const id = app.client?.createPage(subpage ? { subpage: true } : {});
	if (id) void app.updateComplete.then(() => app.page()?.focusTitle());
}

export function go(app: AppHost, sectionId: string, pageId: string): void {
	app.client?.selectSection(sectionId);
	app.client?.selectPage(pageId);
}

export function renameItem(
	app: AppHost,
	detail: { kind: NavItemKind; id: string; name: string },
): void {
	const client = app.client;
	if (!client) return;
	if (detail.kind === 'page') client.renamePage(detail.id, detail.name);
	else if (detail.kind === 'notebook') client.renameNotebook(detail.id, detail.name);
	else client.renameSection(detail.id, detail.name);
}

export function itemMenu(
	app: AppHost,
	detail: { kind: NavItemKind; id: string; x: number; y: number },
): void {
	const context = menuContext(app);
	if (!context) return;
	app.openMenu(
		detail.kind === 'page' ? pageMenu(context, detail.id) : sectionMenu(context, detail.id),
		detail.x,
		detail.y,
	);
}

export function notebookMenuAt(app: AppHost, x: number, y: number): void {
	const context = menuContext(app);
	if (!context) return;
	app.openMenu(
		notebookMenu(context, {
			new: () => void app.client?.createNotebook(),
			import: () => app.pick('archive'),
			exportPage: () => void exportPage(app),
			exportNotebook: () => void exportNotebook(app),
		}),
		x,
		y,
	);
}

export function deleteItem(app: AppHost, detail: { kind: NavItemKind; id: string }): void {
	const client = app.client;
	if (!client || detail.kind === 'notebook') return;
	const batch =
		detail.kind === 'page' ? client.deletePage(detail.id) : client.deleteSection(detail.id);
	app.noticeDeleted(detail.kind, batch, detail.id);
}

export function moveItem(
	app: AppHost,
	detail: { kind: NavItemKind; id: string; direction: -1 | 1 },
): void {
	const { client, state } = app;
	if (!client || !state) return;
	if (detail.kind === 'page') {
		const before = pageNeighbour(state, detail.id, detail.direction);
		const page = state.pages.find((p) => p.id === detail.id);
		if (before !== null && page)
			client.movePage(detail.id, {
				sectionId: page.sectionId,
				...(before ? { beforeId: before } : {}),
			});
	} else if (detail.kind !== 'notebook') {
		const target = sectionNeighbour(state, detail.id, detail.direction);
		if (target) client.moveSection(detail.id, target);
	}
	void app.updateComplete.then(() =>
		app
			.nav()
			?.renderRoot.querySelector<HTMLElement>(`[data-id="${CSS.escape(detail.id)}"]`)
			?.focus(),
	);
}

export function dropItem(
	app: AppHost,
	detail: { source: { kind: NavItemKind; id: string }; target: { kind: NavItemKind; id: string } },
): void {
	const { client, state } = app;
	if (!client || !state) return;
	const { source, target } = detail;
	if (source.kind === 'page') {
		if (target.kind === 'page') {
			const page = state.pages.find((p) => p.id === target.id);
			if (page) client.movePage(source.id, { sectionId: page.sectionId, beforeId: target.id });
		} else if (target.kind === 'section') client.movePage(source.id, { sectionId: target.id });
		return;
	}
	if (target.kind === 'group') client.moveSection(source.id, { parentId: target.id });
	else if (target.kind === 'section') {
		const section = state.sections.find((s) => s.id === target.id);
		if (section) client.moveSection(source.id, { parentId: section.parentId, beforeId: target.id });
	}
}
