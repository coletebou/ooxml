import { findHighlightsByElement } from 'ooxml-ui/pptx';
import type { ElementFindHighlights, FindResult } from 'ooxml-ui/pptx';
import type { PptxSlide } from 'pptx-viewer-core';
import type { InjectionKey } from 'vue';
import { computed, inject, provide } from 'vue';

/**
 * Find matches drawn inside slide text (shared's `find-highlights`).
 *
 * Two layers, like the field context next door: the viewer root provides the
 * find session's matches ({@link FindMatchesKey}), and the editing canvas's
 * stage groups the ones on its slide by element ({@link FindHighlightsKey}),
 * which each `ElementRenderer` (a grouped child's included) reads for its own
 * id. Only the stage that marks itself `interactive` groups them, so a
 * thumbnail, the sorter or a presenter preview of the same slide stays
 * unmarked, as in React, where only the editing canvas gets the matches.
 */

/** The find session as the stages need it: its matches, the current one and the active slide. */
export interface FindMatchesSource {
	matches: readonly FindResult[];
	current: number;
	slideIndex: number;
	/** The active slide's id: a stage painting any other slide (a layout in master view) marks nothing. */
	slideId: string | undefined;
}

/** The viewer root's find session (a getter, so a stage regroups when it changes). */
export const FindMatchesKey: InjectionKey<() => FindMatchesSource | undefined> =
	Symbol('pptx-vue-find-matches');

/** One stage's grouped matches, by the id of the element that paints them. */
export const FindHighlightsKey: InjectionKey<() => ReadonlyMap<string, ElementFindHighlights>> =
	Symbol('pptx-vue-find-highlights');

const NONE: ReadonlyMap<string, ElementFindHighlights> = new Map();

/** Publish the find session to every stage below the viewer root (must be called from `setup`). */
export function provideFindMatches(source: () => FindMatchesSource | undefined): void {
	provide(FindMatchesKey, source);
}

/**
 * Group the find session's matches for the slide this stage paints, or none when
 * `slide` gives nothing (a surface that is not the editing canvas). Must be
 * called from `setup`; the grouping re-runs when the session or the slide change.
 */
export function provideStageFindHighlights(slide: () => PptxSlide | undefined): void {
	const source = inject(FindMatchesKey, undefined);
	const grouped = computed(() => {
		const session = source?.();
		const painted = slide();
		return session && painted?.id === session.slideId && session.matches.length > 0
			? findHighlightsByElement(painted, session.slideIndex, session.matches, session.current)
			: NONE;
	});
	provide(FindHighlightsKey, () => grouped.value);
}

/** The stage's grouped matches (empty outside a stage); read it inside a `computed`. */
export function injectFindHighlights(): () => ReadonlyMap<string, ElementFindHighlights> {
	return inject(FindHighlightsKey, () => NONE);
}
