/**
 * The store of unposted comments every pptx comments pane of one viewer shares, and how a pane
 * writes its boxes back into it without undoing another pane's.
 *
 * @module render/comment-drafts
 */
import type { OfficeCommentDraft, OfficeCommentDrafts } from '../../comments/types';

/**
 * Unposted comments by slide (the `draftKey` each pane syncs with), kept by a binding for as long
 * as its viewer lives, so a draft outlives the pane that holds it: a tab switch, a closed pane or
 * sheet, another slide. A binding makes one with {@link createPptxCommentDrafts}, hands it to every
 * pane, and clears it when a new document loads (slide ids repeat across files): each pane then
 * drops what its boxes hold at its next sync instead of saving it.
 */
export class PptxCommentDrafts extends Map<string, OfficeCommentDrafts> {
	/** Counts the clears, so a pane can tell a new document from a slide switch. */
	generation = 0;
	// A plain property, not `#listeners`: a framework may hand the store out through a reactive
	// proxy, which a private field does not pass.
	private readonly listeners = new Set<(key: string, from: object) => void>();

	override clear(): void {
		super.clear();
		this.generation += 1;
	}

	/** Tell the other panes that `from` (a pane's token) wrote the drafts of `key`. */
	announce(key: string, from: object): void {
		for (const listener of this.listeners) listener(key, from);
	}

	/** Hear every {@link announce}; returns the unsubscribe. */
	listen(listener: (key: string, from: object) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}

export function createPptxCommentDrafts(): PptxCommentDrafts {
	return new PptxCommentDrafts();
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * A pane's boxes after another pane wrote the slide's drafts: each box the pane left alone since
 * `taken` takes what the store holds now (empty once posted elsewhere), and each box it changed
 * keeps its text; `taken` moves to the store's value for the boxes it took.
 */
export function refreshCommentDrafts(
	taken: OfficeCommentDrafts,
	now: OfficeCommentDrafts,
	stored: OfficeCommentDrafts | undefined,
): { boxes: OfficeCommentDrafts; taken: OfficeCommentDrafts } {
	const pick = <T>(was: T | undefined, is: T | undefined, there: T | undefined) =>
		same(was, is) ? { box: there, taken: there } : { box: is, taken: was };
	const comment = pick(taken.comment, now.comment, stored?.comment);
	const edit = pick(taken.edit, now.edit, stored?.edit);
	const ids = new Set([
		...Object.keys(taken.replies ?? {}),
		...Object.keys(now.replies ?? {}),
		...Object.keys(stored?.replies ?? {}),
	]);
	const boxReplies: Record<string, OfficeCommentDraft> = {};
	const takenReplies: Record<string, OfficeCommentDraft> = {};
	for (const id of ids) {
		const reply = pick(taken.replies?.[id], now.replies?.[id], stored?.replies?.[id]);
		if (reply.box) boxReplies[id] = reply.box;
		if (reply.taken) takenReplies[id] = reply.taken;
	}
	const drafts = (
		c: OfficeCommentDraft | undefined,
		r: Record<string, OfficeCommentDraft>,
		e: OfficeCommentDrafts['edit'],
	): OfficeCommentDrafts => ({
		...(c ? { comment: c } : {}),
		...(Object.keys(r).length ? { replies: r } : {}),
		...(e ? { edit: e } : {}),
	});
	return {
		boxes: drafts(comment.box, boxReplies, edit.box),
		taken: drafts(comment.taken, takenReplies, edit.taken),
	};
}

/**
 * `stored` with the boxes a pane changed between `taken` (what its boxes held when it took the
 * slide's drafts) and `now`: a changed box replaces the stored one, an emptied box drops it, and
 * every other box keeps what another pane may have put there. `stored` itself when the pane
 * changed nothing; undefined once nothing is left.
 */
export function mergeCommentDrafts(
	stored: OfficeCommentDrafts | undefined,
	taken: OfficeCommentDrafts,
	now: OfficeCommentDrafts,
): OfficeCommentDrafts | undefined {
	const replyIds = new Set([
		...Object.keys(taken.replies ?? {}),
		...Object.keys(now.replies ?? {}),
	]);
	const changedReplies = [...replyIds].filter(
		(id) => !same(taken.replies?.[id], now.replies?.[id]),
	);
	const changedComment = !same(taken.comment, now.comment);
	const changedEdit = !same(taken.edit, now.edit);
	if (!changedComment && !changedEdit && !changedReplies.length) {
		return stored;
	}
	const comment = changedComment ? now.comment : stored?.comment;
	const edit = changedEdit ? now.edit : stored?.edit;
	const replies: Record<string, OfficeCommentDraft> = { ...stored?.replies };
	for (const id of changedReplies) {
		const reply = now.replies?.[id];
		if (reply) replies[id] = reply;
		else delete replies[id];
	}
	const merged: OfficeCommentDrafts = {
		...(comment ? { comment } : {}),
		...(Object.keys(replies).length ? { replies } : {}),
		...(edit ? { edit } : {}),
	};
	return Object.keys(merged).length ? merged : undefined;
}
