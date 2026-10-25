// @vitest-environment happy-dom
/**
 * Find matches drawn inside slide text by the DOM renderer vanilla paints with.
 * The stage takes the find matches grouped by element (shared
 * `findHighlightsByElement`) and every text shape on it, a grouped child's
 * included, marks the runs they cover (`markFindMatches`) in a `<mark>`.
 */
import type { PptxElement, PptxSlide } from 'ooxml-core/pptx';
import { describe, expect, it } from 'vitest';

import { createTranslator } from '../i18n/translator';
import { findHighlightsByElement } from '../render/find-highlights';
import { findInSlides } from '../render/find-replace';
import { createDefaultRegistry } from './elements';
import { renderSlideStage } from './slide-stage';

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

const slide: PptxSlide = { id: 's1', rId: 'r1', slideNumber: 1, elements: [group] };

function stage(findHighlights?: ReturnType<typeof findHighlightsByElement>): HTMLElement {
	return renderSlideStage({
		document,
		slide,
		canvasSize: { width: 1280, height: 720 },
		mediaDataUrls: new Map<string, string>(),
		registry: createDefaultRegistry(),
		t: createTranslator(),
		...(findHighlights ? { findHighlights } : {}),
	});
}

describe('renderSlideStage find highlights', () => {
	it('marks every match on the slide, the current one apart, across a formatting boundary', () => {
		const matches = findInSlides([slide], 'hello');
		const node = stage(findHighlightsByElement(slide, 0, matches, 1));
		expect(
			[...node.querySelectorAll('mark')].map((mark) => [
				mark.dataset['pptxFindMatch'],
				mark.textContent,
			]),
		).toStrictEqual([
			['match', 'hello'],
			['current', 'hel'],
			['current', 'lo'],
		]);
		// The marks add no text of their own: each box reads exactly as authored.
		expect([...node.querySelectorAll('p')].map((p) => p.textContent)).toStrictEqual([
			'first hello',
			'say hello there',
		]);
		const current = node.querySelector<HTMLElement>('mark[data-pptx-find-match="current"]');
		expect(current?.style.backgroundColor).toBe('#f97316');
	});

	it('marks a shape two groups down', () => {
		const nested: PptxSlide = {
			...slide,
			elements: [{ ...(group as object), id: 'outer', children: [group] } as PptxElement],
		};
		const node = renderSlideStage({
			document,
			slide: nested,
			canvasSize: { width: 1280, height: 720 },
			mediaDataUrls: new Map<string, string>(),
			registry: createDefaultRegistry(),
			t: createTranslator(),
			findHighlights: findHighlightsByElement(nested, 0, findInSlides([nested], 'there'), 0),
		});
		expect([...node.querySelectorAll('mark')].map((mark) => mark.textContent)).toStrictEqual([
			'there',
		]);
	});

	it('marks nothing without find highlights', () => {
		expect(stage().querySelectorAll('mark')).toHaveLength(0);
	});
});
