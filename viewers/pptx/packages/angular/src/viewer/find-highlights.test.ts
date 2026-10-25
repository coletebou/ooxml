/**
 * Find matches drawn inside slide text, Angular side. React was the only
 * binding that marked them; the viewer now groups the find session's matches
 * for the active slide (shared `findHighlightsByElement`), hands them to the
 * editing canvas alone, and the shape renderer marks the runs they cover
 * (shared `markFindMatches`), each wrapped in a `<mark>`.
 *
 * This package has no TestBed (see `vitest.config.ts`), so the view model is
 * tested directly and the wiring through the components by their sources, as in
 * `element-renderer-linked-text.test.ts`.
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findHighlightsByElement, findInSlides } from 'ooxml-ui/pptx';
import type { PptxElement, PptxSlide } from 'pptx-viewer-core';
import { describe, expect, it } from 'vitest';

import { componentSource } from './component-source.test-support';
import { buildAngularParagraphs } from './paragraph-view';

const here = dirname(fileURLToPath(import.meta.url));

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

describe('angular paragraph view find marks', () => {
	it('marks the runs a match covers, across a formatting boundary, the current one apart', () => {
		const element = text('a', ['say hel', 'lo there, hello']);
		const slide = { id: 's1', elements: [element] } as unknown as PptxSlide;
		const highlights = findHighlightsByElement(slide, 0, findInSlides([slide], 'hello'), 1).get(
			'a',
		);
		const runs = buildAngularParagraphs(element, undefined, undefined, highlights)[0]!.runs;
		expect(
			runs.filter((run) => run.findMatch).map((run) => `${run.findMatch}:${run.text}`),
		).toStrictEqual(['match:hel', 'match:lo', 'current:hello']);
	});

	it('marks nothing without highlights', () => {
		const runs = buildAngularParagraphs(text('a', ['hello']))[0]!.runs;
		expect(runs.some((run) => run.findMatch)).toBeFalsy();
	});
});

describe('angular find marks wiring', () => {
	const viewer = componentSource(here, 'power-point-viewer.component.ts');
	const canvas = componentSource(here, 'slide-canvas.component.ts');
	const renderer = componentSource(here, 'element-renderer.component.ts');
	const shape = componentSource(here, 'element-renderer-shape.component.ts');
	const run = componentSource(here, 'slide-text-run.component.ts');

	it('groups the session matches for the active slide and gives them to the editing canvas only', () => {
		expect(viewer).toContain('findHighlightsByElement(');
		expect(viewer.match(/\[findHighlights\]="findHighlights\(\)"/gu)).toHaveLength(1);
		const editorCanvas = viewer.slice(viewer.indexOf('#editorCanvas'));
		expect(editorCanvas.slice(0, editorCanvas.indexOf('/>'))).toContain(
			'[findHighlights]="findHighlights()"',
		);
	});

	it('hands them through the canvas, the renderer and its group children to the shape', () => {
		expect(canvas.match(/\[findHighlights\]="findHighlights\(\)"/gu)).toHaveLength(2);
		const groupBranch = renderer.slice(renderer.indexOf('@for (child of children()'));
		expect(groupBranch.slice(0, groupBranch.indexOf('/>'))).toContain(
			'[findHighlights]="findHighlights()"',
		);
		expect(renderer.match(/\[findHighlights\]="findHighlights\(\)"/gu)).toHaveLength(2);
		expect(shape).toContain('this.findHighlights().get(el.id)');
	});

	it('wraps a marked run in a mark tagged with its kind', () => {
		expect(run).toContain('<mark');
		expect(run).toContain('[attr.data-pptx-find-match]="r.findMatch"');
	});
});
