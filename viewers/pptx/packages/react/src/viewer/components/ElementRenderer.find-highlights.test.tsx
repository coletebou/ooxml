// @vitest-environment happy-dom
/**
 * Find matches drawn inside slide text. The grouping is shared's
 * `findHighlightsByElement` (React used to build its own, keyed by the
 * top-level id, so a grouped shape's matches never reached its text and a
 * match over a formatting boundary stopped at it), and an overlap of two
 * matches is drawn once (React's own chunking repeated the shared letters).
 */
import { findInSlides } from 'ooxml-ui/pptx';
import type { ElementFindHighlights } from 'ooxml-ui/pptx';
import type { PptxElement, PptxSlide } from 'pptx-viewer-core';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderTextSegments } from '../utils/text-paragraph-render';
import type { ZoomViewport } from './canvas/canvas-types';
import { useCanvasEventHandlers } from './canvas/useCanvasEventHandlers';
import { ElementRenderer } from './ElementRenderer';
import type { ElementRendererProps } from './elements/element-renderer-types';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement('div');
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
	container.remove();
});

function text(id: string, texts: string[]): PptxElement {
	return {
		id,
		type: 'text',
		x: 0,
		y: 0,
		width: 300,
		height: 40,
		text: texts.join(''),
		textSegments: texts.map((value) => ({ text: value, style: {} })),
	} as PptxElement;
}

const group = {
	id: 'g',
	type: 'group',
	x: 0,
	y: 0,
	width: 300,
	height: 120,
	children: [text('c1', ['first']), text('c2', ['say hel', 'lo there'])],
} as unknown as PptxElement;

const slide: PptxSlide = { id: 's1', rId: 'rId1', slideNumber: 1, elements: [group] };

function makeProps(overrides: Partial<ElementRendererProps>): ElementRendererProps {
	return {
		element: group,
		isSelected: false,
		isInlineEditing: false,
		inlineEditingText: '',
		canInteract: true,
		spellCheckEnabled: false,
		mediaDataUrls: new Map(),
		selectionColorClass: 'blue-500',
		showHoverBorder: false,
		imageAltText: 'Slide element',
		showResizeHandles: false,
		renderInk: true,
		renderGroups: true,
		adjustmentHandles: [],
		onResizePointerDown: vi.fn<() => void>(),
		onAdjustmentPointerDown: vi.fn<() => void>(),
		onInlineEditChange: vi.fn<() => void>(),
		onInlineEditCommit: vi.fn<() => void>(),
		onInlineEditCancel: vi.fn<() => void>(),
		...overrides,
	};
}

/** What the canvas hook groups for `query` on the slide, the first match current. */
function grouped(query: string): Map<string, ElementFindHighlights> {
	let map = new Map<string, ElementFindHighlights>();
	function Probe(): null {
		map = useCanvasEventHandlers({
			cbRef: {
				current: {
					onClick: vi.fn(),
					onDoubleClick: vi.fn(),
					onMouseDown: vi.fn(),
					onContextMenu: vi.fn(),
				},
			},
			findResults: findInSlides([slide], query),
			findResultIndex: 0,
			activeSlideIndex: 0,
			activeSlide: slide,
			selectedElement: null,
			zoom: { scale: 1 } as unknown as ZoomViewport,
		}).elementFindHighlightsMap;
		return null;
	}
	act(() => {
		root.render(<Probe />);
	});
	return map;
}

const marks = (): Array<[string | null, string]> =>
	[...container.querySelectorAll('mark')].map((mark) => [
		mark.getAttribute('data-pptx-find-match'),
		mark.textContent ?? '',
	]);

describe('react find highlights inside slide text', () => {
	it('groups a grouped shape match under the child and spreads it over a formatting boundary', () => {
		const map = grouped('hello');
		expect([...map.keys()]).toStrictEqual(['c2']);
		expect(map.get('c2')).toStrictEqual(
			new Map([
				[0, [{ startOffset: 4, length: 3, isCurrent: true }]],
				[1, [{ startOffset: 0, length: 2, isCurrent: true }]],
			]),
		);
	});

	it('marks the match in the grouped child it is in', () => {
		const map = grouped('hello');
		render(makeProps({ groupFindHighlights: map }));
		expect(marks()).toStrictEqual([
			['current', 'hel'],
			['current', 'lo'],
		]);
	});

	it('marks the match in a shape two groups down', () => {
		const nested = {
			...group,
			id: 'outer',
			children: [{ ...(group as object), id: 'inner' } as PptxElement],
		} as unknown as PptxElement;
		const deck: PptxSlide = { ...slide, elements: [nested] };
		let map = new Map<string, ElementFindHighlights>();
		function Probe(): null {
			map = useCanvasEventHandlers({
				cbRef: {
					current: {
						onClick: vi.fn(),
						onDoubleClick: vi.fn(),
						onMouseDown: vi.fn(),
						onContextMenu: vi.fn(),
					},
				},
				findResults: findInSlides([deck], 'hello'),
				findResultIndex: 0,
				activeSlideIndex: 0,
				activeSlide: deck,
				selectedElement: null,
				zoom: { scale: 1 } as unknown as ZoomViewport,
			}).elementFindHighlightsMap;
			return null;
		}
		act(() => {
			root.render(<Probe />);
		});
		expect([...map.keys()]).toStrictEqual(['c2']);
		render(makeProps({ element: nested, groupFindHighlights: map }));
		expect(marks()).toStrictEqual([
			['current', 'hel'],
			['current', 'lo'],
		]);
	});

	it('draws two overlapping matches once, the current one stronger', () => {
		const element = text('a', ['aaa']);
		const deck: PptxSlide = { ...slide, elements: [element] };
		const matches = findInSlides([deck], 'aa');
		expect(matches).toHaveLength(2);
		const highlights = new Map([
			[
				0,
				matches.map((match, index) => ({
					startOffset: match.startOffset,
					length: match.length,
					isCurrent: index === 0,
				})),
			],
		]);
		const html = renderToStaticMarkup(
			<>{renderTextSegments(element, '#000000', undefined, highlights)}</>,
		);
		expect(html.replaceAll(/<[^>]+>/gu, '')).toBe('aaa');
		expect(html.match(/<mark[^>]*>/gu)).toStrictEqual([
			expect.stringContaining('#f97316'),
			expect.stringContaining('#facc15'),
		]);
	});
});

function render(props: ElementRendererProps): void {
	act(() => {
		root.render(<ElementRenderer {...props} />);
	});
}
