import type { PptxElement, PptxSlide, TextSegment } from 'ooxml-core/pptx';
import { describe, expect, it } from 'vitest';

import {
	FIND_MATCH_STYLE,
	findHighlightsByElement,
	findMatchParts,
	markFindMatches,
} from './find-highlights';
import type { ElementFindHighlights } from './find-highlights';
import { findInSlides } from './find-replace';
import type { FindResult } from './find-replace';
import type { ParagraphRun, RenderParagraph } from './paragraph-types';
import { buildParagraphs } from './text-paragraphs';

function shape(id: string, texts: string[], extra: Partial<TextSegment> = {}): PptxElement {
	return {
		type: 'text',
		id,
		x: 0,
		y: 0,
		width: 400,
		height: 40,
		text: texts.join(''),
		textSegments: texts.map((text) => ({ text, style: {}, ...extra })),
	} as PptxElement;
}

function slide(elements: PptxElement[]): PptxSlide {
	return { id: 's1', rId: 'rId-s1', slideNumber: 1, elements };
}

const match = (extra: Partial<FindResult>): FindResult => ({
	slideIndex: 0,
	elementId: 'a',
	segmentIndex: 0,
	startOffset: 0,
	length: 1,
	...extra,
});

const paragraph = (runs: ParagraphRun[]): RenderParagraph => ({
	runs,
	bulletStyle: {},
	segmentIndices: [0],
});

/** Each run as `text` with its mark, `[text]` for a match and `{text}` for the current one. */
const marked = (paragraphs: RenderParagraph[]): string =>
	paragraphs
		.flatMap((para) => para.runs)
		.map((run) =>
			run.findMatch === 'current' ? `{${run.text}}` : run.findMatch ? `[${run.text}]` : run.text,
		)
		.join('|');

describe('findHighlightsByElement', () => {
	it('groups the slide matches by element and segment and marks the current one', () => {
		const deck = slide([shape('a', ['hello ', 'yellow']), shape('b', ['mellow'])]);
		const matches = findInSlides([deck, deck], 'ell');
		const byElement = findHighlightsByElement(deck, 0, matches, 1);
		expect([...byElement.keys()]).toStrictEqual(['a', 'b']);
		expect(byElement.get('a')).toStrictEqual(
			new Map([
				[0, [{ startOffset: 1, length: 3, isCurrent: false }]],
				[1, [{ startOffset: 1, length: 3, isCurrent: true }]],
			]),
		);
		expect(byElement.get('b')).toStrictEqual(
			new Map([[0, [{ startOffset: 1, length: 3, isCurrent: false }]]]),
		);
	});

	it('spreads a match that runs on over a formatting boundary into the next segment', () => {
		const deck = slide([shape('a', ['say hel', 'lo there'])]);
		const byElement = findHighlightsByElement(deck, 0, findInSlides([deck], 'hello'), 0);
		expect(byElement.get('a')).toStrictEqual(
			new Map([
				[0, [{ startOffset: 4, length: 3, isCurrent: true }]],
				[1, [{ startOffset: 0, length: 2, isCurrent: true }]],
			]),
		);
	});

	it('keys a match in a grouped shape by the child that paints it', () => {
		const group = {
			type: 'group',
			id: 'g',
			x: 0,
			y: 0,
			width: 400,
			height: 80,
			children: [shape('c1', ['first']), shape('c2', ['second'])],
		} as unknown as PptxElement;
		const deck = slide([group]);
		const matches = findInSlides([deck], 'second');
		expect(matches[0]).toMatchObject({ elementId: 'g', elementPath: [1] });
		expect([...findHighlightsByElement(deck, 0, matches, 0).keys()]).toStrictEqual(['c2']);
		const nested = slide([{ ...(group as object), id: 'outer', children: [group] } as PptxElement]);
		const deep = findInSlides([nested], 'second');
		expect(deep[0]).toMatchObject({ elementId: 'outer', elementPath: [0, 1] });
		expect([...findHighlightsByElement(nested, 0, deep, 0).keys()]).toStrictEqual(['c2']);
	});

	it('leaves out matches in table cells, SmartArt, charts, the notes and other slides', () => {
		const deck = slide([shape('a', ['abc'])]);
		const skipped = [
			match({ tableCell: { rowIndex: 0, colIndex: 0 } }),
			match({ smartArtNodeId: 'n1' }),
			match({ chartTitle: true }),
			match({ chartSeriesIndex: 0 }),
			match({ chartCategoryIndex: 0 }),
			match({ notes: true, elementId: '' }),
			match({ slideIndex: 1 }),
			match({ elementId: 'gone' }),
		];
		expect(findHighlightsByElement(deck, 0, skipped, 0).size).toBe(0);
		expect(findHighlightsByElement(undefined, 0, [match({})], 0).size).toBe(0);
	});

	it('does not mark the characters of a field, whose value is what the slide shows', () => {
		const deck = slide([shape('a', ['12'], { fieldType: 'slidenum' })]);
		expect(findHighlightsByElement(deck, 0, [match({ length: 2 })], 0).size).toBe(0);
	});
});

describe('findMatchParts', () => {
	it('cuts a stretch where matches begin and end, an overlap marked once', () => {
		const h = (startOffset: number, length: number, isCurrent = false) => ({
			startOffset,
			length,
			isCurrent,
		});
		expect(findMatchParts([h(0, 2), h(1, 2, true)], 0, 3)).toStrictEqual([
			{ from: 0, to: 1, kind: 'match' },
			{ from: 1, to: 3, kind: 'current' },
		]);
		expect(findMatchParts([h(1, 2)], 0, 5)).toStrictEqual([
			{ from: 0, to: 1, kind: undefined },
			{ from: 1, to: 3, kind: 'match' },
			{ from: 3, to: 5, kind: undefined },
		]);
		// A match reaching past the stretch is clamped to it.
		expect(findMatchParts([h(3, 9)], 2, 6)).toStrictEqual([
			{ from: 2, to: 3, kind: undefined },
			{ from: 3, to: 6, kind: 'match' },
		]);
	});
});

describe('markFindMatches', () => {
	const highlights = (entries: Array<[number, Array<[number, number, boolean?]>]>) =>
		new Map(
			entries.map(([segment, ranges]) => [
				segment,
				ranges.map(([startOffset, length, isCurrent]) => ({
					startOffset,
					length,
					isCurrent: Boolean(isCurrent),
				})),
			]),
		) as ElementFindHighlights;

	it('hands back the same paragraphs when nothing is marked', () => {
		const paragraphs = [paragraph([{ text: 'hello', style: {}, segmentIndex: 0, charStart: 0 }])];
		expect(markFindMatches(paragraphs, undefined)).toBe(paragraphs);
		expect(markFindMatches(paragraphs, new Map())).toBe(paragraphs);
		expect(markFindMatches(paragraphs, highlights([[1, [[0, 2]]]]))[0]).toBe(paragraphs[0]);
	});

	it('cuts a run at the bounds of its matches, keeping its style, segment and offsets', () => {
		const run: ParagraphRun = {
			text: 'abcabc',
			style: { color: 'red' },
			segmentIndex: 0,
			charStart: 0,
		};
		const [para] = markFindMatches(
			[paragraph([run])],
			highlights([
				[
					0,
					[
						[1, 2],
						[4, 2, true],
					],
				],
			]),
		);
		expect(marked([para!])).toBe('a|[bc]|a|{bc}');
		expect(
			para!.runs.map((piece) => [piece.charStart, piece.style, piece.segmentIndex]),
		).toStrictEqual([
			[0, { color: 'red' }, 0],
			[1, { color: 'red' }, 0],
			[3, { color: 'red' }, 0],
			[4, { color: 'red' }, 0],
		]);
	});

	it('marks the runs of one segment that a match covers by their place in it', () => {
		const runs: ParagraphRun[] = ['say ', 'hello ', 'there'].map((text, index, all) => ({
			text,
			style: {},
			segmentIndex: 2,
			charStart: all.slice(0, index).join('').length,
		}));
		const [para] = markFindMatches([paragraph(runs)], highlights([[2, [[2, 9, true]]]]));
		expect(marked([para!])).toBe('sa|{y }|{hello }|{t}|here');
	});

	it('merges overlapping matches into one mark, the current one taking its own part', () => {
		const run: ParagraphRun = { text: 'aaaa', style: {}, segmentIndex: 0, charStart: 0 };
		const [para] = markFindMatches(
			[paragraph([run])],
			highlights([
				[
					0,
					[
						[0, 2],
						[1, 2, true],
						[2, 2],
					],
				],
			]),
		);
		expect(marked([para!])).toBe('[a]|{aa}|[a]');
	});

	it('steps over the joiners East Asian line breaking adds to a run', () => {
		const run: ParagraphRun = {
			text: '日本\u200B語\u2060',
			style: {},
			segmentIndex: 0,
			charStart: 0,
			inserted: [2, 4],
		};
		const hanging: ParagraphRun = {
			text: ' ',
			style: {},
			segmentIndex: 0,
			charStart: 3,
			hangingSpace: true,
		};
		const [para] = markFindMatches([paragraph([run, hanging])], highlights([[0, [[2, 1]]]]));
		expect(marked([para!])).toBe('日本\u200B|[語\u2060]| ');
	});

	it('counts a zero-width character the text was authored with', () => {
		// "a", a ZERO WIDTH SPACE the author typed, "b": search finds "b" at 2.
		const run: ParagraphRun = { text: 'a\u200Bb', style: {}, segmentIndex: 0, charStart: 0 };
		const [para] = markFindMatches([paragraph([run])], highlights([[0, [[2, 1]]]]));
		expect(marked([para!])).toBe('a\u200B|[b]');
	});

	it('keeps the inserted joiners of each cut piece on that piece', () => {
		const run: ParagraphRun = {
			text: 'ab\u200Bcd\u200B',
			style: {},
			segmentIndex: 0,
			charStart: 0,
			inserted: [2, 5],
		};
		const [para] = markFindMatches([paragraph([run])], highlights([[0, [[2, 1]]]]));
		expect(para!.runs.map((piece) => [piece.text, piece.inserted])).toStrictEqual([
			['ab\u200B', [2]],
			['c', undefined],
			['d\u200B', [1]],
		]);
	});

	it('cuts the per-script font pieces with the text', () => {
		const run: ParagraphRun = {
			text: 'ab日本',
			style: {},
			segmentIndex: 0,
			charStart: 0,
			scriptRuns: [{ text: 'ab' }, { text: '日本', style: { fontFamily: 'MS Mincho' } }],
		};
		const [para] = markFindMatches([paragraph([run])], highlights([[0, [[1, 2]]]]));
		expect(para!.runs.map((piece) => piece.scriptRuns)).toStrictEqual([
			[{ text: 'a' }],
			[{ text: 'b' }, { text: '日', style: { fontFamily: 'MS Mincho' } }],
			[{ text: '本', style: { fontFamily: 'MS Mincho' } }],
		]);
	});

	it('marks a ruby, tabbed or equation run whole rather than cutting it', () => {
		const ruby: ParagraphRun = {
			text: '漢字',
			style: {},
			segmentIndex: 0,
			charStart: 0,
			ruby: { text: 'かんじ', style: {} },
		};
		const tabbed: ParagraphRun = {
			text: 'a\tb',
			style: {},
			segmentIndex: 1,
			charStart: 0,
			tabLines: [],
		};
		const [para] = markFindMatches(
			[paragraph([ruby, tabbed])],
			highlights([
				[0, [[1, 1, true]]],
				[1, [[2, 1]]],
			]),
		);
		expect(marked([para!])).toBe('{漢字}|[a\tb]');
	});

	it('marks what buildParagraphs draws for a search across a formatting boundary', () => {
		const element = shape('a', ['say hel', 'lo there, hello']);
		const deck = slide([element]);
		const byElement = findHighlightsByElement(deck, 0, findInSlides([deck], 'hello'), 1);
		const paragraphs = markFindMatches(buildParagraphs(element), byElement.get('a'));
		expect(
			paragraphs[0]!.runs
				.filter((run) => run.findMatch)
				.map((run) => `${run.findMatch}:${run.text}`)
				.join(','),
		).toBe('match:hel,match:lo,current:hello');
	});

	it('marks the right characters of East Asian text with an authored zero-width space', () => {
		// eaLnBrk="0" makes the run builder add a break after each character; the
		// author's own ZERO WIDTH SPACE before "う" is a character the search counts.
		const element = {
			...shape('a', []),
			text: 'あい\u200Bう',
			textSegments: [
				{ text: 'あい\u200Bう', style: {}, paragraphProperties: { eaLineBreak: false } },
			],
		} as PptxElement;
		const deck = slide([element]);
		const matches = findInSlides([deck], 'う');
		expect(matches).toMatchObject([{ startOffset: 3, length: 1 }]);
		const byElement = findHighlightsByElement(deck, 0, matches, 0);
		const paragraphs = markFindMatches(buildParagraphs(element), byElement.get('a'));
		const runs = paragraphs[0]!.runs;
		expect(
			runs.filter((run) => run.findMatch).map((run) => run.text.replaceAll('\u200B', '')),
		).toStrictEqual(['う']);
		expect(runs.map((run) => run.text).join('')).toBe(
			buildParagraphs(element)[0]!
				.runs.map((run) => run.text)
				.join(''),
		);
	});

	it('styles a mark with a fill of its own, the current match the stronger one', () => {
		expect(FIND_MATCH_STYLE.match).toMatchObject({ backgroundColor: '#facc15', color: 'inherit' });
		expect(FIND_MATCH_STYLE.current).toMatchObject({
			backgroundColor: '#f97316',
			color: 'inherit',
		});
	});
});
