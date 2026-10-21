// Export and import on an open notebook: a page to .docx (its containers and one ink picture in
// reading order), the notebook to an archive, and an archive to a new notebook's first content.
// New code.
import { type PageExportItem, type PageExportOptions, exportPageToDocx } from './docx-export';
import { overLimit } from './snapshot';
import type { ExportedFile } from './client-types';
import { exportNotebookArchive, importNotebookArchive } from './archive';
import { containerBytes } from './canvas';
import { strokesBounds } from './ink';
import { readContainers, readMeta, readPages, readStrokes } from './read';
import { readRichText } from './rich-text';
import { containerFragment, entityMap } from './schema';
import type { OpenNotebook } from './session';
import { type NotebookSnapshot, readSnapshot } from './snapshot';
import type { PageExportReport } from './docx-export';

/** A file name from a title: path and reserved characters removed, never empty. */
export function fileNameOf(title: string, fallback: string, extension: string): string {
	const base =
		title
			.replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '')
			.trim()
			.slice(0, 120) || fallback;
	return `${base}.${extension}`;
}

export async function exportPage(
	open: OpenNotebook,
	pageId: string,
	options: PageExportOptions & { subtitle?: string; untitled?: string } = {},
): Promise<ExportedFile & { report: PageExportReport }> {
	const { types } = open;
	const page = readPages(types).find((p) => p.id === pageId);
	if (!page) throw new Error('No such page');
	const items: PageExportItem[] = [];
	for (const c of readContainers(types, pageId)) {
		if (c.kind === 'text') {
			const map = entityMap(types.containers, c.id);
			const fragment = map && containerFragment(map);
			items.push({
				kind: 'text',
				x: c.x,
				y: c.y,
				blocks: fragment ? readRichText(fragment) : [],
				...(fragment && overLimit(fragment) ? { overLimit: true } : {}),
			});
		} else if (c.kind === 'image') {
			items.push({
				kind: 'image',
				x: c.x,
				y: c.y,
				width: c.width,
				height: c.height,
				name: c.name,
				mime: c.mime,
				alt: c.alt,
				bytes: containerBytes(open.edit, c.id),
			});
		} else {
			items.push({ kind: 'file', x: c.x, y: c.y, name: c.name, size: c.size });
		}
	}
	const strokes = readStrokes(types, pageId);
	if (strokes.length) {
		const bounds = strokesBounds(strokes);
		items.push({ kind: 'ink', x: bounds.x, y: bounds.y, strokes, bounds });
	}
	const untitled = options.untitled ?? 'Untitled page';
	const { bytes, report } = await exportPageToDocx(
		{
			title: page.title || untitled,
			...(options.subtitle ? { subtitle: options.subtitle } : {}),
			items,
		},
		options,
	);
	return {
		bytes,
		report,
		fileName: fileNameOf(page.title, untitled, 'docx'),
		mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	};
}

export async function exportArchive(open: OpenNotebook): Promise<ExportedFile> {
	const bytes = await exportNotebookArchive(readSnapshot(open.edit));
	return {
		bytes,
		fileName: fileNameOf(readMeta(open.types).name, 'Notebook', 'zip'),
		mime: 'application/zip',
	};
}

export const readArchive = (bytes: Uint8Array): Promise<NotebookSnapshot> =>
	importNotebookArchive(bytes);
