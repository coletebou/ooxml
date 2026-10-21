// Pure projections of the notebook for display: the section tree as a flat outline with depths,
// the pages of a section with their subpage structure, and who else is in the notebook. These are
// what `NotebookState` carries and what every binding renders. New code.
import type { RemotePresence } from '../collab/presence';
import { type PageEntry, type SectionEntry, isEntityId } from './model';
import { deletedSectionIds, sectionPages } from './read';

export interface SectionView extends SectionEntry {
	depth: number;
	/** Visible pages in this section (sections only). */
	pageCount: number;
}

export interface PageView extends PageEntry {
	/** The page has subpages directly under it. */
	hasSubpages: boolean;
}

/** What a collaborator publishes: where they are in the notebook. */
export interface NotebookPresence {
	userId?: string;
	pageId?: string;
	/** The container they are editing or have selected. */
	containerId?: string;
}

export interface PeerView {
	clientId: number;
	name: string;
	color: string;
	userId: string;
	pageId: string;
	containerId: string;
}

/** Validate a peer's presence payload (ids only; anything else is dropped). */
export function sanitizeNotebookPresence(raw: Record<string, unknown>): NotebookPresence {
	const out: NotebookPresence = {};
	if (isEntityId(raw.userId)) out.userId = raw.userId;
	if (isEntityId(raw.pageId)) out.pageId = raw.pageId;
	if (isEntityId(raw.containerId)) out.containerId = raw.containerId;
	return out;
}

/** Visible sections and groups in display order (pre-order through groups). */
export function sectionViews(
	sections: readonly SectionEntry[],
	pages: readonly PageEntry[],
): SectionView[] {
	const gone = deletedSectionIds(sections);
	const visible = sections.filter((s) => !gone.has(s.id));
	const counts = new Map<string, number>();
	for (const page of pages)
		if (!page.deleted) counts.set(page.sectionId, (counts.get(page.sectionId) ?? 0) + 1);
	const out: SectionView[] = [];
	const visit = (parentId: string, depth: number): void => {
		for (const s of visible.filter((x) => x.parentId === parentId)) {
			out.push({ ...s, depth, pageCount: s.kind === 'section' ? (counts.get(s.id) ?? 0) : 0 });
			if (s.kind === 'group' && depth < 16) visit(s.id, depth + 1);
		}
	};
	visit('', 0);
	return out;
}

/** The visible pages of a section with valid levels and subpage flags. */
export function pageViews(pages: readonly PageEntry[], sectionId: string): PageView[] {
	const list = sectionPages(pages, sectionId);
	return list.map((page, i) => ({ ...page, hasSubpages: (list[i + 1]?.level ?? -1) > page.level }));
}

/** Every visible page of the notebook in section order (for search and the to-do summary). */
export function notebookPages(
	sections: readonly SectionView[],
	pages: readonly PageEntry[],
): PageEntry[] {
	return sections.filter((s) => s.kind === 'section').flatMap((s) => sectionPages(pages, s.id));
}

export function peerViews(peers: readonly RemotePresence<NotebookPresence>[]): PeerView[] {
	return peers.map((p) => ({
		clientId: p.clientId,
		name: p.userName,
		color: p.userColor,
		userId: p.userId ?? '',
		pageId: p.pageId ?? '',
		containerId: p.containerId ?? '',
	}));
}
