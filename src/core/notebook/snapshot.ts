// A notebook as plain data: what an archive holds and what an import writes back. Only what is
// visible is captured (soft-deleted sections and pages are left out); text is ProseMirror-shaped
// JSON, ink keeps its points, pictures and files carry their bytes. New code.
import * as Y from 'yjs';
import {
	type Container,
	type InkStroke,
	MAX_TEXT_LENGTH,
	MAX_TEXT_NODES,
	type PageEntry,
	type SectionEntry,
} from './model';
import { addFile, addImage, addStroke, addText, containerBytes, readStacking } from './canvas';
import {
	deletedSectionIds,
	readContainers,
	readMeta,
	readPages,
	readSections,
	readStrokes,
} from './read';
import { type RichNode, readRichText } from './rich-text';
import { containerFragment, entityMap } from './schema';
import { type NotebookEditContext, writeMeta } from './structure';

export interface SnapshotContainer {
	container: Container;
	/** Text containers only. */
	content?: RichNode[];
	/** The text box holds more than MAX_TEXT_LENGTH (a collaborator's edits can merge past it). */
	overLimit?: boolean;
	/** Pictures and files only. */
	bytes?: Uint8Array;
}

export interface NotebookSnapshot {
	name: string;
	color: string;
	created: number;
	sections: SectionEntry[];
	pages: PageEntry[];
	containers: SnapshotContainer[];
	strokes: InkStroke[];
}

/** Everything visible in the notebook. */
export function readSnapshot(ctx: Pick<NotebookEditContext, 'types'>): NotebookSnapshot {
	const { types } = ctx;
	const meta = readMeta(types);
	const allSections = readSections(types);
	const gone = deletedSectionIds(allSections);
	const sections = allSections.filter((s) => !gone.has(s.id));
	const visible = new Set(sections.filter((s) => s.kind === 'section').map((s) => s.id));
	const pages = readPages(types).filter((p) => !p.deleted && visible.has(p.sectionId));
	const pageIds = new Set(pages.map((p) => p.id));
	const containers = readContainers(types)
		.filter((c) => pageIds.has(c.pageId))
		.map((container): SnapshotContainer => {
			if (container.kind === 'text') {
				const map = entityMap(types.containers, container.id);
				const fragment = map && containerFragment(map);
				const content = fragment ? readRichText(fragment) : [];
				return fragment && overLimit(fragment)
					? { container, content, overLimit: true }
					: { container, content };
			}
			const bytes = containerBytes(ctx, container.id);
			return bytes ? { container, bytes } : { container };
		});
	const strokes = readStrokes(types).filter((s) => pageIds.has(s.pageId));
	return {
		name: meta.name,
		color: meta.color,
		created: meta.created,
		sections,
		pages,
		containers,
		strokes,
	};
}

/**
 * Write a snapshot into an empty notebook. Section and page ids are kept (they are local to the
 * notebook); containers and strokes get new ids. Returns how many items could not be written.
 */
export function writeSnapshot(edit: NotebookEditContext, snapshot: NotebookSnapshot): number {
	let skipped = 0;
	// Many items in one go: the stacking and drawing order are read once, not for every item.
	const ctx: NotebookEditContext = { ...edit, stacking: readStacking(edit.types) };
	ctx.types.doc.transact(() => {
		writeMeta(ctx, { name: snapshot.name, color: snapshot.color });
		if (snapshot.created) ctx.types.meta.set('created', snapshot.created);
		for (const s of snapshot.sections) {
			const map = new Y.Map<unknown>();
			ctx.types.sections.set(s.id, map);
			map.set('kind', s.kind);
			map.set('name', s.name);
			map.set('color', s.color);
			map.set('parent', s.parentId);
			map.set('order', s.order);
			map.set('created', s.created || ctx.now());
		}
		for (const p of snapshot.pages) {
			const map = new Y.Map<unknown>();
			ctx.types.pages.set(p.id, map);
			map.set('section', p.sectionId);
			map.set('title', p.title);
			map.set('created', p.created || ctx.now());
			map.set('order', p.order);
			map.set('level', p.level);
		}
		for (const { container: c, content, bytes } of snapshot.containers) {
			const at = { x: c.x, y: c.y, width: c.width, height: c.height };
			let id = '';
			if (c.kind === 'text') id = addText(ctx, c.pageId, { ...at, content: content ?? [] });
			else if (bytes && c.kind === 'image')
				id = addImage(ctx, c.pageId, { ...at, name: c.name, mime: c.mime, alt: c.alt, bytes });
			else if (bytes && c.kind === 'file')
				id = addFile(ctx, c.pageId, { ...at, name: c.name, mime: c.mime, bytes });
			if (!id) skipped++;
			else entityMap(ctx.types.containers, id)?.set('z', c.z);
		}
		for (const s of snapshot.strokes)
			if (
				!addStroke(ctx, s.pageId, {
					tool: s.tool,
					color: s.color,
					width: s.width,
					points: s.points,
				})
			)
				skipped++;
	}, ctx.origin);
	return skipped;
}

/** All the text in a fragment, counted without building it. */
export function textLength(fragment: Y.XmlFragment): number {
	let length = 0;
	const stack: unknown[] = fragment.toArray();
	while (stack.length) {
		const item = stack.pop();
		if (item instanceof Y.XmlText) length += item.length;
		else if (item instanceof Y.XmlElement) stack.push(...item.toArray());
	}
	return length;
}

/** More text or more nodes than a text box holds (collaborators' edits can merge past both). */
export function overLimit(fragment: Y.XmlFragment): boolean {
	let nodes = 0;
	const stack: unknown[] = fragment.toArray();
	while (stack.length) {
		const item = stack.pop();
		if (++nodes > MAX_TEXT_NODES) return true;
		if (item instanceof Y.XmlElement) stack.push(...item.toArray());
	}
	return textLength(fragment) > MAX_TEXT_LENGTH;
}
