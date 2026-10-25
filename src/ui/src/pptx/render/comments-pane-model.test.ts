import type {
	PptxComment,
	PptxCommentMention,
	PptxElement,
	PptxModernCommentAuthor,
} from 'ooxml-core/pptx';
import { describe, expect, it } from 'vitest';

import {
	applyCommentsPaneEvent,
	pptxCommentThreads,
	pptxMentionCandidates,
	pptxMentionRecords,
} from './comments-pane-model';

const GRACE = '{2CB2E9D0-D392-EB21-5D46-FBA34C1295E6}';
const AUTHORS: PptxModernCommentAuthor[] = [
	{ id: GRACE, name: 'Grace Hopper', initials: 'GH', userId: 'g@example.com', providerId: 'AD' },
	{ id: '{ADA}', name: 'Ada Lovelace', userId: 'a@example.com', providerId: 'AD' },
	{ id: '', name: 'Nobody', userId: '', providerId: '' },
];
const loaded: PptxCommentMention = {
	id: '{M1}',
	personId: GRACE,
	authorName: 'Grace Hopper',
	startIndex: 4,
	length: 13,
	containerUri: '{EXT}',
};
const comments = (): PptxComment[] => [
	{
		id: 'c1',
		text: 'Ask @Grace Hopper today',
		author: 'Ada Lovelace',
		authorId: '{ADA}',
		createdAt: '2026-10-25T06:00:00Z',
		elementId: 'shape-1',
		mentions: [loaded],
		replies: [
			{
				id: 'r1',
				text: 'On it',
				author: 'Grace Hopper',
				authorId: GRACE,
				parentId: 'c1',
				replies: [{ id: 'r2', text: 'Thanks', author: 'Ada Lovelace', parentId: 'r1' }],
			},
		],
	},
	{ id: 'c2', text: 'Gone', elementId: 'shape-9', resolved: true },
];
const ELEMENTS = [{ id: 'shape-1', type: 'shape', name: 'Title 1' }] as unknown as PptxElement[];
const covered = (comment: PptxComment | undefined) =>
	comment?.mentions?.map((m) => comment.text.slice(m.startIndex, m.startIndex + m.length));
const ids = () => {
	let next = 0;
	return () => `{NEW${(next += 1)}}`;
};

describe('pptxCommentThreads', () => {
	it('draws each comment as a thread, its replies in order at any depth', () => {
		const threads = pptxCommentThreads(comments(), {
			elements: ELEMENTS,
			deletedElementLabel: 'Deleted',
			unknownAuthor: 'Author',
			authors: AUTHORS,
		});
		expect(threads.map((thread) => [thread.id, thread.anchorLabel, thread.resolved])).toStrictEqual(
			[
				['c1', 'Shape', false],
				['c2', 'Deleted', true],
			],
		);
		const [first] = threads;
		expect(first!.comments.map((comment) => [comment.id, comment.author])).toStrictEqual([
			['c1', 'Ada Lovelace'],
			['r1', 'Grace Hopper'],
			['r2', 'Ada Lovelace'],
		]);
		expect(first!.comments[0]).toStrictEqual({
			id: 'c1',
			author: 'Ada Lovelace',
			created: '2026-10-25T06:00:00Z',
			text: 'Ask @Grace Hopper today',
			mentions: [{ start: 4, length: 13, id: GRACE, name: 'Grace Hopper', key: '{M1}' }],
		});
		expect(first!.comments[1]!.initials).toBe('GH');
		expect(threads[1]!.comments[0]!.author).toBe('Author');
	});

	it('leaves the anchor out without the slide elements, and takes a label function', () => {
		expect(pptxCommentThreads(comments())[0]).not.toHaveProperty('anchorLabel');
		const named = pptxCommentThreads(comments(), {
			elements: ELEMENTS,
			elementLabel: (element) => element.name ?? '',
		});
		expect(named[0]!.anchorLabel).toBe('Title 1');
	});
});

describe('pptxMentionCandidates', () => {
	it('offers the deck authors that have an id and a name', () => {
		expect(pptxMentionCandidates(AUTHORS)).toStrictEqual([
			{ id: GRACE, name: 'Grace Hopper', initials: 'GH' },
			{ id: '{ADA}', name: 'Ada Lovelace' },
		]);
		expect(pptxMentionCandidates(undefined)).toStrictEqual([]);
	});
});

describe('pptxMentionRecords', () => {
	it('keeps the record behind a keyed span and makes a record for a new pick', () => {
		const records = pptxMentionRecords(
			[
				{ start: 11, length: 13, id: GRACE, name: 'Grace Hopper', key: '{M1}' },
				{ start: 30, length: 13, id: '{ADA}', name: 'Ada Lovelace' },
				{ start: 50, length: 4 },
			],
			[loaded],
			ids(),
		);
		expect(records).toStrictEqual([
			{ ...loaded, startIndex: 11 },
			{ id: '{NEW1}', personId: '{ADA}', authorName: 'Ada Lovelace', startIndex: 30, length: 13 },
		]);
	});

	it('finds a record without a mention id by its place in the list', () => {
		const plain = { personId: GRACE, startIndex: 0, length: 6 };
		const [span] = pptxCommentThreads([{ id: 'c', text: '@Grace', mentions: [plain] }])[0]!
			.comments[0]!.mentions!;
		expect(span!.key).toBe('#0');
		expect(pptxMentionRecords([{ ...span!, start: 2 }], [plain], ids())).toStrictEqual([
			{ ...plain, startIndex: 2 },
		]);
	});

	it('keeps each span with its own person when the list moved under a place key', () => {
		const ada = { personId: '{ADA}', authorName: 'Ada', startIndex: 0, length: 4 };
		const grace = { personId: GRACE, authorName: 'Grace', startIndex: 5, length: 6 };
		const spans = pptxCommentThreads([{ id: 'c', text: '@Ada @Grace', mentions: [ada, grace] }])[0]!
			.comments[0]!.mentions!;
		expect(spans.map((span) => span.key)).toStrictEqual(['#0', '#1']);
		// A collaborator took Ada out, so Grace is now the record at #0.
		const records = pptxMentionRecords(spans, [{ ...grace, startIndex: 0 }], ids());
		expect(records.map((record) => record.personId)).toStrictEqual(['{ADA}', GRACE]);
		expect(records[0]).toStrictEqual({
			id: '{NEW1}',
			personId: '{ADA}',
			authorName: 'Ada',
			startIndex: 0,
			length: 4,
		});
	});
});

describe('applyCommentsPaneEvent', () => {
	const context = { authorName: 'Ada Lovelace', generateMentionId: ids() };

	it('adds a comment on the selected element, with its mentions as new records', () => {
		const next = applyCommentsPaneEvent(
			comments(),
			{
				type: 'comment-add',
				detail: { text: 'Hi @Grace Hopper', mentions: [{ start: 3, length: 13, id: GRACE }] },
			},
			{ ...context, elementId: 'shape-1' },
		);
		const added = next!.at(-1)!;
		expect(added).toMatchObject({ text: 'Hi @Grace Hopper', author: 'Ada Lovelace' });
		expect(added.elementId).toBe('shape-1');
		expect(covered(added)).toStrictEqual(['@Grace Hopper']);
		expect(added.mentions![0]!.personId).toBe(GRACE);
	});

	it('replies under the thread', () => {
		const next = applyCommentsPaneEvent(
			comments(),
			{ type: 'comment-reply', detail: { threadId: 'c1', text: 'Done' } },
			context,
		);
		expect(next![0]!.replies!.map((reply) => reply.text)).toStrictEqual(['On it', 'Done']);
	});

	it('edits with the pane spans, keeping the loaded records behind them', () => {
		const next = applyCommentsPaneEvent(
			comments(),
			{
				type: 'comment-edit',
				detail: {
					threadId: 'c1',
					commentId: 'c1',
					text: 'Please ask @Grace Hopper today',
					mentions: [{ start: 11, length: 13, id: GRACE, name: 'Grace Hopper', key: '{M1}' }],
				},
			},
			context,
		);
		expect(next![0]!.mentions).toStrictEqual([{ ...loaded, startIndex: 11 }]);
		expect(covered(next![0])).toStrictEqual(['@Grace Hopper']);
	});

	it('edits a nested reply, its own mentions following the text without pane spans', () => {
		const next = applyCommentsPaneEvent(
			comments(),
			{ type: 'comment-edit', detail: { threadId: 'c1', commentId: 'r2', text: 'Thanks!' } },
			context,
		);
		expect(next![0]!.replies![0]!.replies![0]!.text).toBe('Thanks!');
	});

	it('deletes a comment, and resolves or reopens a thread only when that changes it', () => {
		const deleted = applyCommentsPaneEvent(
			comments(),
			{ type: 'comment-delete', detail: { threadId: 'c1', commentId: 'r1' } },
			context,
		);
		expect(deleted![0]!.replies).toStrictEqual([]);
		const resolve = (type: 'thread-resolve' | 'thread-reopen', threadId: string) =>
			applyCommentsPaneEvent(comments(), { type, detail: { threadId } }, context);
		expect(resolve('thread-resolve', 'c1')![0]!.resolved).toBe(true);
		expect(resolve('thread-resolve', 'c2')).toBeNull();
		expect(resolve('thread-reopen', 'c2')![1]!.resolved).toBe(false);
		expect(resolve('thread-reopen', 'c1')).toBeNull();
		expect(resolve('thread-resolve', 'missing')).toBeNull();
	});
});
