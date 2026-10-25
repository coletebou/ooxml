import { findHighlightsByElement } from 'ooxml-ui/pptx';
import type { ElementFindHighlights, FindResult } from 'ooxml-ui/pptx';
import type { PptxSlide } from 'pptx-viewer-core';
import { getContext, setContext } from 'svelte';

/**
 * Svelte context wiring for find matches drawn inside slide text (shared
 * `find-highlights`), mirroring Vue's `find-highlights` composable.
 *
 * Two layers, like the field context next door: `createViewerState` provides
 * the find session's matches ({@link FindMatchesKey}), and the editing canvas's
 * `SlideStage` groups the ones on its slide by element ({@link FindHighlightsKey}),
 * which each `ElementRenderer` (a grouped child's included) reads for its own
 * id. Only an interactive stage painting the active slide groups them, so a
 * thumbnail, the sorter or a presenter preview stays unmarked, as in React.
 *
 * Both values are getters, captured once at component initialisation like
 * every Svelte context here, so a consumer's `$derived` stays live.
 */

/** The find session as the stages need it: its matches, the current one and the active slide. */
export interface FindMatchesSource {
	matches: readonly FindResult[];
	current: number;
	slideIndex: number;
	/** The active slide's id: a stage painting any other slide (a layout in master view) marks nothing. */
	slideId: string | undefined;
}

/** Exported so tests can seed it via `mount(Component, { context })`. */
export const FindMatchesKey = Symbol('pptx-svelte-find-matches');
const FindHighlightsKey = Symbol('pptx-svelte-find-highlights');

type FindHighlightsGetter = () => ReadonlyMap<string, ElementFindHighlights>;

const NONE: ReadonlyMap<string, ElementFindHighlights> = new Map();

/** Publish the find session to every stage below the viewer root (call at init). */
export function provideFindMatches(source: () => FindMatchesSource | undefined): void {
	setContext(FindMatchesKey, source);
}

/**
 * Group the find session's matches for the slide this stage paints, or none when
 * `slide` gives nothing (a surface that is not the editing canvas). Call at init.
 */
export function provideStageFindHighlights(slide: () => PptxSlide | undefined): void {
	const source = getContext<(() => FindMatchesSource | undefined) | undefined>(FindMatchesKey);
	const grouped = $derived.by(() => {
		const session = source?.();
		const painted = slide();
		return session && painted?.id === session.slideId && session.matches.length > 0
			? findHighlightsByElement(painted, session.slideIndex, session.matches, session.current)
			: NONE;
	});
	setContext<FindHighlightsGetter>(FindHighlightsKey, () => grouped);
}

/** This stage's grouped matches (empty outside a stage); call at init, read inside a `$derived`. */
export function getFindHighlightsGetter(): FindHighlightsGetter {
	return getContext<FindHighlightsGetter | undefined>(FindHighlightsKey) ?? (() => NONE);
}
