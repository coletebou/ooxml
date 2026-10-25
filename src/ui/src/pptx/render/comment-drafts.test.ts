import { describe, expect, it } from 'vitest';

import {
	createPptxCommentDrafts,
	mergeCommentDrafts,
	refreshCommentDrafts,
} from './comment-drafts';

describe('mergeCommentDrafts', () => {
	it('applies only the boxes a pane changed onto what the store holds now', () => {
		const stored = { comment: { text: 'From another pane' }, replies: { t1: { text: 'Kept' } } };
		const taken = { replies: { t1: { text: 'Kept' } } };
		const now = { replies: { t1: { text: 'Kept' }, t2: { text: 'Mine' } } };
		expect(mergeCommentDrafts(stored, taken, now)).toStrictEqual({
			comment: { text: 'From another pane' },
			replies: { t1: { text: 'Kept' }, t2: { text: 'Mine' } },
		});
	});

	it('drops a box the pane emptied, and the entry once nothing is left', () => {
		const taken = { comment: { text: 'Posted' }, edit: { commentId: 'c1', text: 'Done' } };
		expect(
			mergeCommentDrafts(taken, taken, { edit: { commentId: 'c1', text: 'Done' } }),
		).toStrictEqual({
			edit: { commentId: 'c1', text: 'Done' },
		});
		expect(mergeCommentDrafts(taken, taken, {})).toBeUndefined();
	});

	it('changes nothing for a pane that changed nothing', () => {
		const stored = { comment: { text: 'Theirs' } };
		expect(mergeCommentDrafts(stored, {}, {})).toBe(stored);
		expect(mergeCommentDrafts(undefined, {}, {})).toBeUndefined();
	});
});

describe('refreshCommentDrafts', () => {
	it('takes what the store holds for the boxes a pane left alone, keeping the ones it changed', () => {
		const taken = { comment: { text: 'Posted elsewhere' }, replies: { t1: { text: 'Old' } } };
		const now = { comment: { text: 'Posted elsewhere' }, replies: { t1: { text: 'Typing here' } } };
		const stored = { replies: { t1: { text: 'Old' }, t2: { text: 'From the other pane' } } };
		expect(refreshCommentDrafts(taken, now, stored)).toStrictEqual({
			boxes: { replies: { t1: { text: 'Typing here' }, t2: { text: 'From the other pane' } } },
			taken: { replies: { t1: { text: 'Old' }, t2: { text: 'From the other pane' } } },
		});
	});
});

describe('createPptxCommentDrafts', () => {
	it('tells its listeners through a proxy, as a framework reactive wrapper hands it out', () => {
		const drafts = createPptxCommentDrafts();
		const wrapped = new Proxy(drafts, {});
		const heard: string[] = [];
		const stop = wrapped.listen((key) => heard.push(key));
		wrapped.announce('s1', {});
		stop();
		wrapped.announce('s2', {});
		expect(heard).toStrictEqual(['s1']);
	});

	it('counts each clear, so panes can tell a new document from a slide switch', () => {
		const drafts = createPptxCommentDrafts();
		drafts.set('s1', { comment: { text: 'x' } });
		const before = drafts.generation;
		drafts.clear();
		expect(drafts.size).toBe(0);
		expect(drafts.generation).toBe(before + 1);
	});
});
