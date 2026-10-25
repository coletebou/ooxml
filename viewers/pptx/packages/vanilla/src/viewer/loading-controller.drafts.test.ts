import { createPptxCommentDrafts } from 'ooxml-ui/pptx';
import { PptxHandler } from 'pptx-viewer-core';
import { describe, expect, it } from 'vitest';

import { presentationLoadFixtures } from '../../../shared/test-utils/presentation-load.mjs';
import { createLoadingController } from './loading-controller';
import { createInitialViewerState, createStore } from './state';

describe('presentation load and unposted comments', () => {
	it('clears the drafts store before the new deck lands, so no pane shows the last one', async () => {
		const fixtures = await presentationLoadFixtures(PptxHandler, 'image');
		const store = createStore(createInitialViewerState());
		const commentDrafts = createPptxCommentDrafts();
		commentDrafts.set('ppt/slides/slide1.xml', { comment: { text: 'From the last deck' } });
		const before = commentDrafts.generation;
		const seen: number[] = [];
		store.subscribe(() => {
			if (store.get().slides.length) {
				seen.push(commentDrafts.generation);
			}
		});
		const loader = createLoadingController({
			options: {},
			store,
			getTranslator: () => (key) => key,
			getEditor: () => undefined,
			commentDrafts,
		});
		try {
			await loader.load(fixtures.first);
			expect(commentDrafts.size).toBe(0);
			expect(seen[0]).toBe(before + 1);
		} finally {
			loader.releaseLoaded();
		}
	}, 30_000);
});
