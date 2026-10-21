// The notebook archive: a zip with `notebook.json` (structure, text as ProseMirror-shaped JSON, ink
// points) and the bytes of pictures and files under `media/`. Opening one goes through the shared
// zip guards (input size, entry count, inflated size, safe part names), and every value is
// re-validated with the same sanitisers the shared document uses. New code.
import JSZip from 'jszip';
import { MAX_INK_POINTS } from './ink';
import { openZip } from '../opc/zip-limits';
import {
	type Container,
	type InkStroke,
	type PageEntry,
	type SectionEntry,
	MAX_FILE_BYTES,
	clampNumber,
	isEntityId,
	sanitizeFileName,
	sanitizeHexColor,
	sanitizeLevel,
	sanitizeLine,
	sanitizeMime,
	sanitizeName,
	sanitizeTimestamp,
	sanitizeTitle,
} from './model';
import { detectOfficeKind } from '../opc/office-kind';
import { paletteColor } from './palette';
import type { RichNode } from './rich-text';
import type { NotebookSnapshot, SnapshotContainer } from './snapshot';

export const NOTEBOOK_ARCHIVE_FORMAT = 'ooxml-notebook';
export const NOTEBOOK_ARCHIVE_VERSION = 1;
const MANIFEST = 'notebook.json';
/** The inflated size an archive may have: export refuses a notebook that would not import. */
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
/** Sections, pages, containers or strokes an archive holds at most (each); more is refused. */
const MAX_ITEMS = 500_000;

const EXTENSIONS: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/bmp': 'bmp',
	'image/svg+xml': 'svg',
};

const mediaName = (c: Container): string => {
	const ext =
		c.kind === 'image'
			? (EXTENSIONS[c.mime] ?? 'bin')
			: c.kind === 'file'
				? (c.name.split('.').pop() ?? 'bin')
				: 'bin';
	return `media/${c.id}.${ext.replace(/[^\w]/gu, '').slice(0, 8) || 'bin'}`;
};

/** A notebook snapshot as a zip archive. */
export async function exportNotebookArchive(snapshot: NotebookSnapshot): Promise<Uint8Array> {
	const counts = [snapshot.sections, snapshot.pages, snapshot.containers, snapshot.strokes];
	if (counts.some((list) => list.length > MAX_ITEMS))
		throw new NotebookArchiveError('This notebook holds more items than an archive takes');
	const media = snapshot.containers.reduce((sum, c) => sum + (c.bytes?.length ?? 0), 0);
	// The manifest (with every text box's content) counts against the same size.
	const written = JSON.stringify(snapshot.containers.map((c) => c.content ?? null)).length;
	if (media + written > MAX_ARCHIVE_BYTES)
		throw new NotebookArchiveError('This notebook is larger than an archive takes');
	if (snapshot.containers.some((c) => c.overLimit))
		throw new NotebookArchiveError('A text box holds more text than an archive takes');
	const zip = new JSZip();
	const containers = snapshot.containers.map(({ container, content, bytes }) => {
		const media = bytes ? mediaName(container) : undefined;
		if (media && bytes) zip.file(media, bytes);
		return { ...container, ...(content ? { content } : {}), ...(media ? { media } : {}) };
	});
	const manifest = {
		format: NOTEBOOK_ARCHIVE_FORMAT,
		version: NOTEBOOK_ARCHIVE_VERSION,
		notebook: { name: snapshot.name, color: snapshot.color, created: snapshot.created },
		sections: snapshot.sections.map(({ deleted: _deleted, ...s }) => s),
		pages: snapshot.pages.map(({ deleted: _deleted, ...p }) => p),
		containers,
		ink: snapshot.strokes,
	};
	zip.file(MANIFEST, JSON.stringify(manifest));
	return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export class NotebookArchiveError extends Error {
	override readonly name = 'NotebookArchiveError';
}

type Raw = Record<string, unknown>;
const records = (value: unknown): Raw[] => {
	if (!Array.isArray(value)) return [];
	// A longer list is refused, not cut short: an import never drops part of a notebook unsaid.
	if (value.length > MAX_ITEMS)
		throw new NotebookArchiveError('This archive holds more items than an import takes');
	return value.filter((v): v is Raw => !!v && typeof v === 'object');
};
const num = (value: unknown, fallback = 0): number =>
	typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export interface ArchiveImportOptions {
	/** Total bytes of pictures and files an import may take (default 512 MiB). */
	maxMediaBytes?: number;
}

/** Read an archive back as a snapshot. Throws `NotebookArchiveError` when it is not one. */
export async function importNotebookArchive(
	bytes: Uint8Array,
	options: ArchiveImportOptions = {},
): Promise<NotebookSnapshot> {
	// Each media entry is inflated once, however many containers name it, and all of them together
	// stay within a budget: a small archive that names one entry thousands of times stays small.
	const media = new Map<string, Uint8Array | null>();
	let budget = options.maxMediaBytes ?? 512 * 1024 * 1024;
	const zip = await openZip(bytes, { label: 'Notebook archive', maxTotalBytes: MAX_ARCHIVE_BYTES });
	const entry = zip.file(MANIFEST);
	if (!entry) throw new NotebookArchiveError('Not a notebook archive: notebook.json is missing');
	let manifest: Raw;
	try {
		manifest = JSON.parse(await entry.async('string')) as Raw;
	} catch {
		throw new NotebookArchiveError('Not a notebook archive: notebook.json is not valid JSON');
	}
	if (manifest.format !== NOTEBOOK_ARCHIVE_FORMAT)
		throw new NotebookArchiveError('Not a notebook archive: unknown format');
	if (num(manifest.version) > NOTEBOOK_ARCHIVE_VERSION)
		throw new NotebookArchiveError('This notebook archive was written by a newer version');
	const meta = (manifest.notebook ?? {}) as Raw;
	const sections = records(manifest.sections)
		.filter((s) => isEntityId(s.id))
		.map((s, i): SectionEntry => ({
			id: s.id as string,
			kind: s.kind === 'group' ? 'group' : 'section',
			name: sanitizeName(s.name, 'Section'),
			color: sanitizeHexColor(s.color, paletteColor(i)),
			parentId: isEntityId(s.parentId) ? s.parentId : '',
			order: num(s.order, i + 1),
			created: sanitizeTimestamp(s.created),
		}));
	const pages = records(manifest.pages)
		.filter((p) => isEntityId(p.id) && isEntityId(p.sectionId))
		.map((p, i): PageEntry => ({
			id: p.id as string,
			sectionId: p.sectionId as string,
			title: sanitizeTitle(p.title),
			created: sanitizeTimestamp(p.created),
			order: num(p.order, i + 1),
			level: sanitizeLevel(p.level),
		}));
	const containers: SnapshotContainer[] = [];
	for (const c of records(manifest.containers)) {
		if (!isEntityId(c.id) || !isEntityId(c.pageId)) continue;
		const base = {
			id: c.id,
			pageId: c.pageId,
			x: num(c.x),
			y: num(c.y),
			width: num(c.width, 320),
			height: num(c.height, 0),
			z: num(c.z),
		};
		if (c.kind === 'text') {
			containers.push({
				container: { ...base, kind: 'text' },
				content: Array.isArray(c.content) ? (c.content as RichNode[]) : [],
			});
			continue;
		}
		if (c.kind !== 'image' && c.kind !== 'file') continue;
		const path = typeof c.media === 'string' ? c.media : '';
		if (!media.has(path)) {
			const file = path.startsWith('media/') ? zip.file(path) : null;
			media.set(path, file ? await file.async('uint8array') : null);
		}
		const data = media.get(path);
		// A listed picture or file that is not there (or too large) is refused, not dropped unsaid.
		if (!data || !data.length || data.length > MAX_FILE_BYTES)
			throw new NotebookArchiveError('This archive is missing a picture or file it lists');
		budget -= data.length;
		if (budget < 0)
			throw new NotebookArchiveError('This archive holds more media than an import takes');
		const name = sanitizeFileName(c.name, c.kind === 'image' ? 'picture' : 'file');
		const mime = sanitizeMime(c.mime);
		const container: Container =
			c.kind === 'image'
				? { ...base, kind: 'image', name, mime, alt: sanitizeLine(c.alt, 500) }
				: {
						...base,
						kind: 'file',
						name,
						mime,
						size: data.length,
						office: detectOfficeKind(name, mime),
					};
		containers.push({ container, bytes: data });
	}
	const strokes = records(manifest.ink)
		.filter((s) => {
			if (!isEntityId(s.id) || !isEntityId(s.pageId) || !Array.isArray(s.points)) return false;
			if (s.points.length > MAX_INK_POINTS * 3)
				throw new NotebookArchiveError('This archive has a stroke longer than a notebook holds');
			return true;
		})
		.map((s): InkStroke => ({
			id: s.id as string,
			pageId: s.pageId as string,
			tool: s.tool === 'highlighter' ? 'highlighter' : 'pen',
			color: sanitizeHexColor(s.color, '#202020'),
			width: clampNumber(s.width, 0.5, 64, 2),
			points: (s.points as unknown[]).filter(
				(v): v is number => typeof v === 'number' && Number.isFinite(v),
			),
		}));
	return {
		name: sanitizeName(meta.name, 'Notebook'),
		color: sanitizeHexColor(meta.color, paletteColor(0)),
		created: sanitizeTimestamp(meta.created),
		sections,
		pages,
		containers,
		strokes,
	};
}
