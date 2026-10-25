/**
 * Find matches drawn inside slide text: which characters of a text body the
 * find session's matches cover, cut out of the runs `buildParagraphs` returns,
 * and the mark a binding wraps each covered run in.
 *
 * Only React drew matches inside the text, from a grouping and a segment split
 * of its own (`useCanvasEventHandlers`, `text-segment-helpers`). Vue, Angular,
 * Svelte and vanilla held the same session (`find-replace-session`) and drew
 * nothing, so a match was only reported by the bar's count and the slide it
 * moved to. This is the one grouping and the one cut: a binding passes an
 * element's highlights to {@link markFindMatches} after `buildParagraphs` and
 * wraps a run that has `findMatch` in a `<mark>` styled by
 * {@link FIND_MATCH_STYLE}, around everything else it draws for the run.
 *
 * @module render/find-highlights
 */
import type { PptxElement, PptxSlide } from 'ooxml-core/pptx';
import { hasTextProperties } from 'ooxml-core/pptx';

import type { FindResult } from './find-replace';
import type { ParagraphRun, RenderParagraph } from './paragraph-types';
import type { RunStyle } from './text-run-style';
import type { ScriptFontPiece } from './text-script-fonts';

/** A match the find bar is on (`current`), or any other match. */
export type FindMatchKind = NonNullable<ParagraphRun['findMatch']>;

/** One match's characters within one text segment. */
export interface SegmentFindHighlight {
	startOffset: number;
	length: number;
	isCurrent: boolean;
}

/** One element's highlights, by the index of the text segment they are in. */
export type ElementFindHighlights = ReadonlyMap<number, readonly SegmentFindHighlight[]>;

/**
 * The mark around a matched run: React's fills, the current match the stronger
 * one. `color: inherit` undoes the user agent's black `<mark>` text, so a run
 * that declares no colour of its own keeps the text body's.
 */
export const FIND_MATCH_STYLE: Readonly<Record<FindMatchKind, Readonly<RunStyle>>> = Object.freeze({
	match: Object.freeze({ backgroundColor: '#facc15', color: 'inherit', borderRadius: '2px' }),
	current: Object.freeze({ backgroundColor: '#f97316', color: 'inherit', borderRadius: '2px' }),
});

/** A match in a shape's own text (not a table cell, SmartArt, a chart or the notes). */
const isShapeTextMatch = (match: FindResult): boolean =>
	!match.notes &&
	!match.tableCell &&
	match.smartArtNodeId === undefined &&
	!match.chartTitle &&
	match.chartSeriesIndex === undefined &&
	match.chartCategoryIndex === undefined;

/** The element a match is in: the top-level one, or the grouped child its path leads to. */
function matchedElement(slide: PptxSlide, match: FindResult): PptxElement | undefined {
	let element = slide.elements.find((candidate) => candidate.id === match.elementId);
	for (const index of match.elementPath ?? []) {
		element = element?.type === 'group' ? element.children[index] : undefined;
	}
	return element;
}

/**
 * The find session's matches on one slide, by the id of the element that paints
 * them and then by text segment. Search gives a grouped shape's match the group's
 * id and the path to the child; this keys it by the child. A match that runs on
 * across a formatting boundary (the search does not stop at one) is spread over
 * the segments it covers. A field's characters (a slide number, a date) are not
 * marked: the slide shows the field's value, not the text that was searched.
 */
export function findHighlightsByElement(
	slide: PptxSlide | undefined,
	slideIndex: number,
	matches: readonly FindResult[],
	current: number,
): Map<string, ElementFindHighlights> {
	const byElement = new Map<string, Map<number, SegmentFindHighlight[]>>();
	if (!slide) {
		return byElement;
	}
	matches.forEach((match, index) => {
		if (match.slideIndex !== slideIndex || !isShapeTextMatch(match)) {
			return;
		}
		const element = matchedElement(slide, match);
		const segments = element && hasTextProperties(element) ? element.textSegments : undefined;
		if (!element || !segments?.length) {
			return;
		}
		const isCurrent = index === current;
		let segmentIndex = match.segmentIndex;
		let offset = match.startOffset;
		let left = match.length;
		for (; left > 0 && segmentIndex < segments.length; segmentIndex++, offset = 0) {
			const segment = segments[segmentIndex];
			const length = Math.min(left, (segment?.text.length ?? 0) - offset);
			if (!segment || length < 0) {
				break;
			}
			left -= length;
			if (length === 0 || segment.fieldType) {
				continue;
			}
			let bySegment = byElement.get(element.id);
			if (!bySegment) {
				bySegment = new Map();
				byElement.set(element.id, bySegment);
			}
			const highlight = { startOffset: offset, length, isCurrent };
			const inSegment = bySegment.get(segmentIndex);
			if (inSegment) {
				inSegment.push(highlight);
			} else {
				bySegment.set(segmentIndex, [highlight]);
			}
		}
	});
	return byElement;
}

/** The characters East Asian line breaking added to a run's text (`ParagraphRun.inserted`). */
const insertedIn = (run: ParagraphRun): ReadonlySet<number> =>
	new Set((run.inserted ?? []).filter((at) => at < run.text.length));

/** Where in the run's text the segment character `offset` characters in is; past the last, its length. */
function textIndex(text: string, inserted: ReadonlySet<number>, offset: number): number {
	let seen = 0;
	for (let at = 0; at < text.length; at++) {
		if (inserted.has(at)) {
			continue;
		}
		if (seen === offset) {
			return at;
		}
		seen++;
	}
	return text.length;
}

/** The inserted characters of the run's text between two places, from the first of them. */
const insertedBetween = (inserted: ReadonlySet<number>, from: number, to: number): number[] =>
	[...inserted].filter((at) => at >= from && at < to).map((at) => at - from);

/** The per-script font pieces of `pieces` that fall between two places in the run's text. */
function sliceScriptRuns(
	pieces: readonly ScriptFontPiece[],
	from: number,
	to: number,
): ScriptFontPiece[] {
	const sliced: ScriptFontPiece[] = [];
	let at = 0;
	for (const piece of pieces) {
		const start = Math.max(from, at);
		const end = Math.min(to, at + piece.text.length);
		if (start < end) {
			sliced.push({ ...piece, text: piece.text.slice(start - at, end - at) });
		}
		at += piece.text.length;
	}
	return sliced;
}

/** A stretch of a segment's characters and the mark it takes (none when no match covers it). */
export interface FindMatchPart {
	from: number;
	to: number;
	kind: FindMatchKind | undefined;
}

/**
 * The characters from `start` to `end` of a segment, cut where `highlights`
 * begin and end: marked `current` where the find bar's match covers them,
 * `match` where another does, unmarked elsewhere. Search counts overlapping
 * matches (`aa` twice in `aaa`), so a stretch two matches share is one part,
 * never repeated.
 */
export function findMatchParts(
	highlights: readonly SegmentFindHighlight[],
	start: number,
	end: number,
): FindMatchPart[] {
	const bounds = new Set([start, end]);
	for (const h of highlights) {
		bounds.add(Math.min(end, Math.max(start, h.startOffset)));
		bounds.add(Math.min(end, Math.max(start, h.startOffset + h.length)));
	}
	const points = [...bounds].sort((a, b) => a - b);
	const parts: FindMatchPart[] = [];
	for (let at = 0; at + 1 < points.length; at++) {
		const from = points[at]!;
		const to = points[at + 1]!;
		const covering = highlights.filter(
			(h) => h.startOffset <= from && h.startOffset + h.length >= to,
		);
		const kind =
			covering.length === 0 ? undefined : covering.some((h) => h.isCurrent) ? 'current' : 'match';
		const last = parts[parts.length - 1];
		if (last && last.kind === kind) {
			last.to = to;
		} else {
			parts.push({ from, to, kind });
		}
	}
	return parts;
}

/** One run, cut at the bounds of the matches over it (or marked whole when it cannot be cut). */
function markRun(
	run: ParagraphRun,
	highlights: readonly SegmentFindHighlight[] | undefined,
): ParagraphRun[] {
	if (!highlights?.length || run.hangingSpace) {
		return [run];
	}
	const start = run.charStart ?? 0;
	const inserted = insertedIn(run);
	const end = start + run.text.length - inserted.size;
	const covering = highlights.filter(
		(h) => h.startOffset < end && h.startOffset + h.length > start,
	);
	if (covering.length === 0) {
		return [run];
	}
	// Ruby is laid out over its whole base, tab pieces sit at measured stops, and
	// an equation has no text: these take the mark whole.
	if (run.equation || run.ruby || run.tabLines || run.underlineWordPieces) {
		return [{ ...run, findMatch: covering.some((h) => h.isCurrent) ? 'current' : 'match' }];
	}
	const { scriptRuns, inserted: _inserted, ...base } = run;
	return findMatchParts(covering, start, end).map(({ from, to, kind }) => {
		const textFrom = textIndex(run.text, inserted, from - start);
		const textTo = textIndex(run.text, inserted, to - start);
		const piece: ParagraphRun = {
			...base,
			text: run.text.slice(textFrom, textTo),
			charStart: from,
		};
		if (scriptRuns) {
			piece.scriptRuns = sliceScriptRuns(scriptRuns, textFrom, textTo);
		}
		const own = insertedBetween(inserted, textFrom, textTo);
		if (own.length > 0) {
			piece.inserted = own;
		}
		if (kind) {
			piece.findMatch = kind;
		}
		return piece;
	});
}

/**
 * `paragraphs` with the runs `highlights` covers cut out and marked (`findMatch`).
 * Without highlights it is `paragraphs` itself, and an untouched paragraph is
 * kept as it was, so a binding memoising on either does no new work.
 *
 * A linked text box chain (`buildParagraphs`' `segmentOverrides`) is searched
 * through its head box, which paints the first of those segments under their
 * own indices, so its marks line up; the text the chain moves on into a later
 * box is not marked, since that box's runs count its own slice.
 */
export function markFindMatches(
	paragraphs: RenderParagraph[],
	highlights: ElementFindHighlights | undefined,
): RenderParagraph[] {
	if (!highlights?.size) {
		return paragraphs;
	}
	return paragraphs.map((paragraph) => {
		const runs = paragraph.runs.flatMap((run) =>
			run.segmentIndex === undefined ? [run] : markRun(run, highlights.get(run.segmentIndex)),
		);
		const same =
			runs.length === paragraph.runs.length && runs.every((run, at) => run === paragraph.runs[at]);
		return same ? paragraph : { ...paragraph, runs };
	});
}
