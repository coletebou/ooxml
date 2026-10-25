/**
 * Find matches drawn inside slide text, Vue side. React was the only binding
 * that marked them; the viewer root now provides the find session's matches
 * and the editing canvas's stage marks the runs they cover (shared's
 * `findHighlightsByElement` and `markFindMatches`), thumbnails and other
 * surfaces never.
 */
import { mount } from '@vue/test-utils';
import { findInSlides } from 'ooxml-ui/pptx';
import type { PptxElement, PptxSlide } from 'pptx-viewer-core';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import { FindMatchesKey } from '../composables/find-highlights';
import type { FindMatchesSource } from '../composables/find-highlights';
import type { CanvasSize } from '../types';
import SlideStage from './SlideStage.vue';

const canvasSize: CanvasSize = { width: 960, height: 540 };

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

async function mountStage(source: FindMatchesSource, interactive: boolean, painted = slide) {
	const wrapper = mount(SlideStage, {
		props: { slide: painted, canvasSize, mediaDataUrls: new Map<string, string>(), interactive },
		global: { provide: { [FindMatchesKey as symbol]: () => source } },
	});
	await nextTick();
	return wrapper;
}

const marks = (wrapper: Awaited<ReturnType<typeof mountStage>>) =>
	wrapper.findAll('mark').map((mark) => [mark.attributes('data-pptx-find-match'), mark.text()]);

describe('slideStage find highlights', () => {
	it('marks every match on the slide, the current one apart, across a formatting boundary', async () => {
		const matches = findInSlides([slide], 'hello');
		expect(matches).toHaveLength(2);
		const wrapper = await mountStage({ matches, current: 1, slideIndex: 0, slideId: 's1' }, true);
		expect(marks(wrapper)).toStrictEqual([
			['match', 'hello'],
			['current', 'hel'],
			['current', 'lo'],
		]);
		// The marks add no text of their own: each box reads exactly as authored.
		expect(wrapper.findAll('p').map((p) => p.text())).toStrictEqual([
			'first hello',
			'say hello there',
		]);
		const style = wrapper.get('mark[data-pptx-find-match="current"]').attributes('style');
		expect(style).toContain('background-color: #f97316');
	});

	it('marks a shape two groups down', async () => {
		const nested = {
			id: 's1',
			elements: [{ ...(group as object), id: 'outer', children: [group] }],
		} as unknown as PptxSlide;
		const matches = findInSlides([nested], 'there');
		const wrapper = await mountStage(
			{ matches, current: 0, slideIndex: 0, slideId: 's1' },
			true,
			nested,
		);
		expect(marks(wrapper)).toStrictEqual([['current', 'there']]);
	});

	it('marks nothing for matches on another slide', async () => {
		const matches = findInSlides([slide, slide], 'hello').filter((m) => m.slideIndex === 1);
		const wrapper = await mountStage({ matches, current: 0, slideIndex: 0, slideId: 's1' }, true);
		expect(wrapper.findAll('mark')).toHaveLength(0);
	});

	it('marks nothing on a stage painting another slide than the active one (a layout)', async () => {
		const matches = findInSlides([slide], 'hello');
		const wrapper = await mountStage(
			{ matches, current: 0, slideIndex: 0, slideId: 'other' },
			true,
		);
		expect(wrapper.findAll('mark')).toHaveLength(0);
	});

	it('marks nothing on a surface other than the editing canvas', async () => {
		const matches = findInSlides([slide], 'hello');
		const wrapper = await mountStage({ matches, current: 0, slideIndex: 0, slideId: 's1' }, false);
		expect(wrapper.findAll('mark')).toHaveLength(0);
	});
});
