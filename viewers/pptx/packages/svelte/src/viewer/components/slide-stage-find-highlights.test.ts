import { findInSlides } from 'ooxml-ui/pptx';
import type { PptxElement, PptxSlide } from 'pptx-viewer-core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';

import { FindMatchesKey } from '../state/find-highlights.svelte';
import type { FindMatchesSource } from '../state/find-highlights.svelte';
import SlideStage from './SlideStage.svelte';

/**
 * Find matches drawn inside slide text, Svelte side. React was the only binding
 * that marked them; the viewer root now provides the find session's matches
 * and the editing canvas's stage marks the runs they cover (shared
 * `findHighlightsByElement` and `markFindMatches`), thumbnails and other
 * surfaces never.
 */

function text(id: string, texts: string[]): PptxElement {
	return {
		type: 'text',
		id,
		x: 0,
		y: 0,
		width: 300,
		height: 40,
		text: texts.join(''),
		textSegments: texts.map((value) => ({ text: value, style: {} })),
	} as PptxElement;
}

const group = {
	type: 'group',
	id: 'g',
	x: 0,
	y: 0,
	width: 300,
	height: 120,
	children: [text('c1', ['first hello']), text('c2', ['say hel', 'lo there'])],
} as unknown as PptxElement;

const slide = { id: 's1', elements: [group] } as unknown as PptxSlide;

let cleanup: (() => void) | undefined;

function mountStage(source: FindMatchesSource, interactive: boolean, painted = slide): HTMLElement {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(SlideStage, {
		target,
		props: {
			slide: painted,
			canvasSize: { width: 960, height: 540 },
			mediaDataUrls: new Map(),
			interactive,
		},
		context: new Map<unknown, unknown>([[FindMatchesKey, () => source]]),
	});
	flushSync();
	cleanup = () => {
		unmount(instance);
		target.remove();
	};
	return target;
}

afterEach(() => {
	cleanup?.();
	cleanup = undefined;
});

const marks = (target: HTMLElement) =>
	[...target.querySelectorAll('mark')].map((mark) => [
		mark.getAttribute('data-pptx-find-match'),
		mark.textContent,
	]);

describe('svelte slide stage find highlights', () => {
	it('marks every match on the slide, the current one apart, across a formatting boundary', () => {
		const matches = findInSlides([slide], 'hello');
		expect(matches).toHaveLength(2);
		const target = mountStage({ matches, current: 1, slideIndex: 0, slideId: 's1' }, true);
		expect(marks(target)).toStrictEqual([
			['match', 'hello'],
			['current', 'hel'],
			['current', 'lo'],
		]);
		// The marks add no text of their own: each box reads exactly as authored.
		expect([...target.querySelectorAll('p')].map((p) => p.textContent)).toStrictEqual([
			'first hello',
			'say hello there',
		]);
		const current = target.querySelector<HTMLElement>('mark[data-pptx-find-match="current"]');
		expect(current?.getAttribute('style')).toContain('background-color: #f97316');
	});

	it('marks a shape two groups down', () => {
		const nested = {
			id: 's1',
			elements: [{ ...(group as object), id: 'outer', children: [group] }],
		} as unknown as PptxSlide;
		const matches = findInSlides([nested], 'there');
		const target = mountStage({ matches, current: 0, slideIndex: 0, slideId: 's1' }, true, nested);
		expect(marks(target)).toStrictEqual([['current', 'there']]);
	});

	it('marks nothing for matches on another slide', () => {
		const matches = findInSlides([slide, slide], 'hello').filter((m) => m.slideIndex === 1);
		const target = mountStage({ matches, current: 0, slideIndex: 0, slideId: 's1' }, true);
		expect(target.querySelectorAll('mark')).toHaveLength(0);
	});

	it('marks nothing on a stage painting another slide than the active one (a layout)', () => {
		const matches = findInSlides([slide], 'hello');
		const target = mountStage({ matches, current: 0, slideIndex: 0, slideId: 'other' }, true);
		expect(target.querySelectorAll('mark')).toHaveLength(0);
	});

	it('marks nothing on a surface other than the editing canvas', () => {
		const matches = findInSlides([slide], 'hello');
		const target = mountStage({ matches, current: 0, slideIndex: 0, slideId: 's1' }, false);
		expect(target.querySelectorAll('mark')).toHaveLength(0);
	});
});
