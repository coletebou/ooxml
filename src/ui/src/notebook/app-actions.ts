// The app's commands: every ribbon button, the export and import flows, embedded files, the Link
// dialog and the shortcuts that work outside a text container. Text formatting runs on the last
// active container's editor and gives it focus back, as a ribbon does.
import type { Command } from 'prosemirror-state';
import {
	activeFormats,
	indentListItem,
	linkRangeAt,
	outdentListItem,
	setBlockStyle,
	setLink,
	toggleFormat,
	toggleHighlight,
	toggleList,
	toggleTodo,
} from 'ooxml-core/notebook/editor';
import type { ExportedFile } from 'ooxml-core/notebook';
import { isOpenableHyperlinkHref } from 'ooxml-core/opc';
import type { AppHost } from './app-host';
import { addPage, addSection } from './app-nav';
import { belowContent } from './page-files';
import { formatCreated, notebookI18n } from './i18n/translator';
import { downloadBytes, rasterize } from './raster';
import { strokeWidthOf } from './ribbon';
import type { NotebookExportDetail, NotebookOpenFileDetail } from './notebook-app';

function onText(app: AppHost, command: Command): void {
	const view = app.editor;
	if (!view || !view.dom.isConnected) return;
	command(view.state, view.dispatch, view);
	view.focus();
}

const ZOOMS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

export function runCommand(app: AppHost, command: string): void {
	const client = app.client;
	switch (command) {
		case 'undo':
			return client?.undo();
		case 'redo':
			return client?.redo();
		case 'bold':
		case 'italic':
		case 'underline':
		case 'strike':
			return onText(app, toggleFormat(command));
		case 'highlight':
			return onText(app, toggleHighlight());
		case 'bullets':
			return onText(app, toggleList('bullet'));
		case 'numbering':
			return onText(app, toggleList('ordered'));
		case 'indent':
			return onText(app, indentListItem);
		case 'outdent':
			return onText(app, outdentListItem);
		case 'normal':
			return onText(app, setBlockStyle('paragraph'));
		case 'heading1':
		case 'heading2':
		case 'heading3':
			return onText(app, setBlockStyle(command));
		case 'todo':
			return onText(app, toggleTodo);
		case 'text': {
			const id = client?.addText(belowContent(app.state?.containers ?? []));
			if (id) app.focusId = id;
			return;
		}
		case 'picture':
		case 'file':
			return app.pick(command);
		case 'link':
			return openLinkDialog(app);
		case 'new-page':
			return addPage(app);
		case 'new-subpage':
			return addPage(app, true);
		case 'new-section':
			return addSection(app, 'section');
		case 'new-group':
			return addSection(app, 'group');
		case 'tool-type':
		case 'tool-pen':
		case 'tool-highlighter':
		case 'tool-eraser':
			app.tool = command.slice(5) as AppHost['tool'];
			return;
		case 'nav':
			app.navOpen = !app.navOpen;
			return;
		case 'todos':
			app.todosOpen = !app.todosOpen;
			return;
		case 'search':
			app.navOpen = true;
			void app.updateComplete.then(() => app.nav()?.focusSearch());
			return;
		case 'zoom-in':
		case 'zoom-out': {
			const at = ZOOMS.findIndex((z) => z >= app.zoom - 0.001);
			const next =
				ZOOMS[
					Math.min(
						ZOOMS.length - 1,
						Math.max(0, (at < 0 ? 3 : at) + (command === 'zoom-in' ? 1 : -1)),
					)
				];
			app.zoom = next ?? 1;
			return;
		}
		case 'zoom-reset':
			app.zoom = 1;
			return;
		default: {
			const width = strokeWidthOf(command);
			if (width !== undefined) app.strokeWidth = width;
		}
	}
}

export function setInkColor(app: AppHost, color: string): void {
	if (app.tool === 'highlighter') app.highlighterColor = color;
	else {
		app.penColor = color;
		if (app.tool !== 'pen') app.tool = 'pen';
	}
}

function save(app: AppHost, file: ExportedFile, kind: NotebookExportDetail['kind']): void {
	const detail: NotebookExportDetail = {
		fileName: file.fileName,
		mime: file.mime,
		bytes: file.bytes,
		kind,
	};
	if (app.emit('notebook-export', detail, true))
		downloadBytes(file.bytes, file.fileName, file.mime);
}

export async function exportPage(app: AppHost): Promise<void> {
	const client = app.client;
	const page = app.state?.page;
	if (!client || !page) return;
	const created = formatCreated(page.created, notebookI18n(app.locale));
	try {
		const file = await client.exportPage(page.id, {
			subtitle: `${created.date} ${created.time}`,
			untitled: app.tr('page.untitled'),
			fileLabel: (f) => app.tr('export.file', { name: f.name }),
			rasterize,
		});
		save(app, file, 'docx');
		const skipped = file.report.skipped.length;
		app.notify(
			skipped
				? app.trn('notice.skipped', skipped)
				: app.tr('notice.exported', { name: file.fileName }),
		);
	} catch {
		// The client already announced the failure.
	}
}

export async function exportNotebook(app: AppHost): Promise<void> {
	const client = app.client;
	if (!client || !app.state?.notebook) return;
	try {
		const file = await client.exportNotebook();
		save(app, file, 'archive');
		app.notify(app.tr('notice.exported', { name: file.fileName }));
	} catch {
		app.notify(app.tr('notice.export-failed'));
	}
}

export async function importArchive(app: AppHost, file: File): Promise<void> {
	try {
		await app.client?.importNotebook(new Uint8Array(await file.arrayBuffer()));
	} catch {
		// The client announced it (`import-failed`).
	}
}

export function openEmbedded(app: AppHost, id: string, download = false): void {
	const container = app.state?.containers.find((c) => c.id === id);
	const bytes = app.client?.containerBytes(id);
	if (!container || container.kind === 'text' || !bytes) return;
	if (download) {
		save(app, { bytes, fileName: container.name, mime: container.mime }, 'file');
		return;
	}
	const kind = container.kind === 'file' ? container.office : 'other';
	const detail: NotebookOpenFileDetail = {
		id: container.id,
		name: container.name,
		mime: container.mime,
		kind,
		bytes,
	};
	if (app.emit('notebook-open-file', detail, true))
		downloadBytes(bytes, container.name, container.mime);
}

export function openLinkDialog(app: AppHost): void {
	const view = app.editor;
	if (!view || !view.dom.isConnected) return;
	const { from, to, empty } = view.state.selection;
	// With the cursor in a link, the dialog edits that whole link.
	const around = empty ? linkRangeAt(view.state, from) : null;
	const active = activeFormats(view.state).link;
	const href = around?.href ?? active ?? '';
	const text = around
		? view.state.doc.textBetween(around.from, around.to, ' ')
		: empty
			? ''
			: view.state.doc.textBetween(from, to, ' ');
	// Only an address a viewer may open is offered for editing (a peer could have stored another).
	app.link = {
		href: isOpenableHyperlinkHref(href) ? href : '',
		text,
		linked: !!around || !!active,
	};
}

export function applyLink(app: AppHost, href: string | null, text = ''): void {
	app.link = null;
	onText(app, setLink(href, text));
}

const inField = (event: KeyboardEvent): boolean =>
	event.composedPath().some((n) => {
		const el = n as HTMLElement;
		return (
			el.tagName === 'INPUT' ||
			el.tagName === 'TEXTAREA' ||
			el.isContentEditable === true ||
			el.tagName === 'NOTEBOOK-TEXT'
		);
	});

/** Shortcuts that work anywhere in the app outside a text field. */
export function appKeys(app: AppHost, event: KeyboardEvent): void {
	const mod = event.ctrlKey || event.metaKey;
	if (mod && event.key.toLowerCase() === 'e') {
		event.preventDefault();
		runCommand(app, 'search');
		return;
	}
	if (!mod || inField(event)) return;
	const key = event.key.toLowerCase();
	if (key === 'z' && !event.shiftKey) {
		event.preventDefault();
		app.client?.undo();
	} else if (key === 'y' || (key === 'z' && event.shiftKey)) {
		event.preventDefault();
		app.client?.redo();
	}
}
