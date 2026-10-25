// @vitest-environment happy-dom
import type { PptxComment, PptxSlide } from 'pptx-viewer-core';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useComments } from './useComments';
import type { UseCommentsInput, UseCommentsResult } from './useComments-helpers';

const SLIDES = [
	{ id: 's1', slideNumber: 1, elements: [], comments: [] },
	{ id: 's2', slideNumber: 2, elements: [], comments: [] },
] as unknown as PptxSlide[];
const NEXT: PptxComment[] = [{ id: 'c1', text: 'Here', author: 'Ada' }];

let unmount: (() => void) | null = null;
afterEach(() => {
	unmount?.();
	unmount = null;
});

/** Mount the hook once and hand back its result plus the write spies. */
function mountHook(input: Partial<UseCommentsInput>) {
	const onUpdateSlides = vi.fn<UseCommentsInput['onUpdateSlides']>();
	const onMarkDirty = vi.fn<() => void>();
	let result: UseCommentsResult | null = null;
	function Probe(): null {
		result = useComments({
			slides: SLIDES,
			activeSlideIndex: 0,
			canEdit: true,
			onUpdateSlides,
			onMarkDirty,
			...input,
		});
		return null;
	}
	const container = document.createElement('div');
	const root = createRoot(container);
	act(() => root.render(<Probe />));
	unmount = () => act(() => root.unmount());
	return { result: () => result!, onUpdateSlides, onMarkDirty };
}

describe('useComments whole-list writes', () => {
	it('writes the slide its list as one update and marks the deck dirty', () => {
		const { result, onUpdateSlides, onMarkDirty } = mountHook({ userName: 'Ada' });
		expect(result().authorName).toBe('Ada');
		act(() => result().handleSetSlideComments(1, NEXT));

		expect(onUpdateSlides).toHaveBeenCalledOnce();
		const written = onUpdateSlides.mock.calls[0]![0](SLIDES);
		expect(written[1]!.comments).toBe(NEXT);
		expect(written[0]).toBe(SLIDES[0]);
		expect(onMarkDirty).toHaveBeenCalledOnce();
	});

	it('hands out one drafts store for the viewer, so unposted comments outlive the pane', () => {
		const { result, onUpdateSlides } = mountHook({});
		const store = result().commentDrafts;
		expect(store).toBeInstanceOf(Map);
		act(() => result().handleSetSlideComments(0, NEXT));
		expect(onUpdateSlides).toHaveBeenCalledOnce();
		expect(result().commentDrafts).toBe(store);
	});

	it('writes nothing while read only or for a slide that is not there', () => {
		const readOnly = mountHook({ canEdit: false });
		act(() => readOnly.result().handleSetSlideComments(0, NEXT));
		expect(readOnly.onUpdateSlides).not.toHaveBeenCalled();
		unmount?.();

		const editable = mountHook({});
		expect(editable.result().authorName).toBe('You');
		act(() => editable.result().handleSetSlideComments(7, NEXT));
		expect(editable.onUpdateSlides).not.toHaveBeenCalled();
		expect(editable.onMarkDirty).not.toHaveBeenCalled();
	});
});
