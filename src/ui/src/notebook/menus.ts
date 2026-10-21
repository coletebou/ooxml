// The notebook's context menus as data for the shared `office-ui-context-menu` (controlled mode):
// each menu is a list of rows and one function that runs a chosen row. Moving up or down picks
// the neighbour in display order; colours are a group of checked rows in the palette.
import type { NotebookClient, NotebookState } from 'ooxml-core/notebook';
import { SECTION_PALETTE } from 'ooxml-core/notebook';
import type { OfficeMenuItem } from '../menu/menu-model';
import type { NotebookKey } from './i18n/translator';

export interface MenuSpec {
	label: string;
	items: OfficeMenuItem[];
	run: (id: string) => void;
}

export interface MenuContext {
	client: NotebookClient;
	state: NotebookState;
	t: (key: NotebookKey, params?: Record<string, string | number>) => string;
	rename: (kind: 'section' | 'group' | 'page' | 'notebook', id: string) => void;
	deleted: (
		kind: 'section' | 'group' | 'page' | 'notebook',
		batch: string | null,
		id: string,
	) => void;
}

const colorRows = (c: MenuContext, current: string): OfficeMenuItem[] =>
	SECTION_PALETTE.map((color, i) => ({
		id: `color:${color.value}`,
		label: c.t(`color.${color.name}` as NotebookKey),
		checked: color.value === current,
		...(i === 0 ? { heading: c.t('menu.color'), separatorBefore: true } : {}),
	}));

/** The sibling before (-1) or after (+1) an item, for Move up and Move down. */
export function sectionNeighbour(
	state: NotebookState,
	id: string,
	direction: -1 | 1,
): { parentId: string; beforeId?: string } | null {
	const item = state.sections.find((s) => s.id === id);
	if (!item) return null;
	const siblings = state.sections.filter((s) => s.parentId === item.parentId);
	const at = siblings.findIndex((s) => s.id === id);
	const target = siblings[at + direction];
	if (!target) return null;
	const before = direction < 0 ? target.id : siblings[at + 2]?.id;
	return { parentId: item.parentId, ...(before ? { beforeId: before } : {}) };
}

export function pageNeighbour(
	state: NotebookState,
	id: string,
	direction: -1 | 1,
): string | undefined | null {
	const pages = state.pages;
	const at = pages.findIndex((p) => p.id === id);
	if (at < 0) return null;
	const level = pages[at]!.level;
	// Step over the neighbour's subpages, so a page moves past a whole block.
	// Only a sibling (same level, same parent) is a neighbour: a subpage never moves out of its
	// parent page, and the first or last one has none in that direction.
	if (direction < 0) {
		let i = at - 1;
		while (i >= 0 && pages[i]!.level > level) i--;
		return i >= 0 && pages[i]!.level === level ? pages[i]!.id : null;
	}
	let end = at + 1;
	while (end < pages.length && pages[end]!.level > level) end++;
	if (end >= pages.length || pages[end]!.level !== level) return null;
	let next = end + 1;
	while (next < pages.length && pages[next]!.level > pages[end]!.level) next++;
	return pages[next]?.id;
}

export function sectionMenu(c: MenuContext, id: string): MenuSpec | null {
	const item = c.state.sections.find((s) => s.id === id);
	if (!item) return null;
	const group = item.kind === 'group';
	const items: OfficeMenuItem[] = [
		{ id: 'rename', label: c.t('menu.rename'), icon: 'pencil' },
		...(group
			? [{ id: 'new-section', label: c.t('cmd.newSection'), icon: 'notebook-section' }]
			: [{ id: 'new-page', label: c.t('cmd.newPage'), icon: 'notebook-page' }]),
		{ id: 'up', label: c.t('menu.moveUp'), disabled: !sectionNeighbour(c.state, id, -1) },
		{ id: 'down', label: c.t('menu.moveDown'), disabled: !sectionNeighbour(c.state, id, 1) },
		...(item.parentId ? [{ id: 'out', label: c.t('menu.moveOut') }] : []),
		...colorRows(c, item.color),
		{ id: 'delete', label: c.t('menu.delete'), icon: 'trash', danger: true, separatorBefore: true },
	];
	return {
		label: item.name,
		items,
		run(action) {
			if (action === 'rename') c.rename(item.kind, id);
			else if (action === 'new-section') c.client.createSection({ parentId: id });
			else if (action === 'new-page') c.client.createPage({ sectionId: id });
			else if (action === 'up' || action === 'down') {
				const target = sectionNeighbour(c.state, id, action === 'up' ? -1 : 1);
				if (target) c.client.moveSection(id, target);
			} else if (action === 'out') {
				const parent = c.state.sections.find((s) => s.id === item.parentId);
				c.client.moveSection(id, { parentId: parent?.parentId ?? '' });
			} else if (action.startsWith('color:')) c.client.setSectionColor(id, action.slice(6));
			else if (action === 'delete') c.deleted(item.kind, c.client.deleteSection(id), id);
		},
	};
}

export function pageMenu(c: MenuContext, id: string): MenuSpec | null {
	const page = c.state.pages.find((p) => p.id === id);
	if (!page) return null;
	const index = c.state.pages.indexOf(page);
	const before = c.state.pages[index - 1];
	return {
		label: page.title || c.t('page.untitled'),
		items: [
			{ id: 'rename', label: c.t('menu.rename'), icon: 'pencil' },
			{
				id: 'subpage',
				label: c.t('menu.subpage'),
				disabled: !before || page.level >= 2 || page.level > before.level,
			},
			{ id: 'promote', label: c.t('menu.promote'), disabled: page.level === 0 },
			{
				id: 'up',
				label: c.t('menu.moveUp'),
				disabled: pageNeighbour(c.state, id, -1) === null,
				separatorBefore: true,
			},
			{ id: 'down', label: c.t('menu.moveDown'), disabled: pageNeighbour(c.state, id, 1) === null },
			{
				id: 'delete',
				label: c.t('menu.delete'),
				icon: 'trash',
				danger: true,
				separatorBefore: true,
			},
		],
		run(action) {
			if (action === 'rename') c.rename('page', id);
			else if (action === 'subpage') c.client.indentPage(id, 1);
			else if (action === 'promote') c.client.indentPage(id, -1);
			else if (action === 'up' || action === 'down') {
				const target = pageNeighbour(c.state, id, action === 'up' ? -1 : 1);
				if (target !== null)
					c.client.movePage(id, {
						sectionId: page.sectionId,
						...(target ? { beforeId: target } : {}),
					});
			} else if (action === 'delete') c.deleted('page', c.client.deletePage(id), id);
		},
	};
}

export function containerMenu(
	c: MenuContext,
	id: string,
	open: (id: string) => void,
	download: (id: string) => void,
): MenuSpec | null {
	const container = c.state.containers.find((x) => x.id === id);
	if (!container) return null;
	const binary = container.kind !== 'text';
	return {
		label: container.kind === 'text' ? c.t('container.text') : container.name,
		items: [
			{ id: 'front', label: c.t('menu.bringFront'), icon: 'bringToFront' },
			...(container.kind === 'file'
				? [{ id: 'open', label: c.t('menu.open'), icon: 'share' }]
				: []),
			...(binary
				? [{ id: 'download', label: c.t('menu.download'), icon: 'notebook-download' }]
				: []),
			{
				id: 'delete',
				label: c.t('menu.delete'),
				icon: 'trash',
				danger: true,
				separatorBefore: true,
			},
		],
		run(action) {
			if (action === 'front') c.client.bringToFront(id);
			else if (action === 'open') open(id);
			else if (action === 'download') download(id);
			else if (action === 'delete') c.client.deleteContainers([id]);
		},
	};
}

export function notebookMenu(
	c: MenuContext,
	actions: Record<'new' | 'import' | 'exportPage' | 'exportNotebook', () => void>,
): MenuSpec {
	const current = c.state.notebookId;
	const meta = c.state.notebook;
	return {
		label: c.t('nav.switch'),
		items: [
			...c.state.notebooks.map((n, i) => ({
				id: `open:${n.id}`,
				label: n.name,
				checked: n.id === current,
				...(i === 0 ? { heading: c.t('app.label') } : {}),
			})),
			{ id: 'new', label: c.t('file.new'), icon: 'plus', separatorBefore: true },
			{ id: 'import', label: c.t('file.import'), icon: 'notebook-import' },
			{
				id: 'export-page',
				label: c.t('file.exportPage'),
				icon: 'notebook-download',
				disabled: !c.state.page,
				separatorBefore: true,
			},
			{
				id: 'export-notebook',
				label: c.t('file.exportNotebook'),
				icon: 'notebook-archive',
				disabled: !meta,
			},
			{
				id: 'rename',
				label: c.t('file.rename'),
				icon: 'pencil',
				disabled: !meta,
				separatorBefore: true,
			},
			...(meta
				? colorRows(c, meta.color).map((row) => ({ ...row, id: `nbcolor:${row.id.slice(6)}` }))
				: []),
			{
				id: 'delete',
				label: c.t('file.delete'),
				icon: 'trash',
				danger: true,
				disabled: !meta,
				separatorBefore: true,
			},
		],
		run(action) {
			if (action.startsWith('open:')) void c.client.openNotebook(action.slice(5));
			else if (action === 'new') actions.new();
			else if (action === 'import') actions.import();
			else if (action === 'export-page') actions.exportPage();
			else if (action === 'export-notebook') actions.exportNotebook();
			else if (action === 'rename' && current) c.rename('notebook', current);
			else if (action.startsWith('nbcolor:') && current)
				c.client.setNotebookColor(current, action.slice(8));
			else if (action === 'delete' && current) {
				// The notice (with Undo) only when it went: it stays when its changes could not be saved.
				void c.client
					.deleteNotebook(current)
					.then((done) => done && c.deleted('notebook', null, current));
			}
		},
	};
}
