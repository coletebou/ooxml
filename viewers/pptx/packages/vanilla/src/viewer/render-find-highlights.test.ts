/**
 * Find matches drawn inside slide text, vanilla side. React was the only
 * binding that marked them; the find session now publishes its matches and its
 * current one in the store, and the editing canvas's stage marks the runs they
 * cover (shared `findHighlightsByElement` and `markFindMatches`), the slide
 * thumbnails never.
 */
import { createTextElement, PptxHandler } from 'pptx-viewer-core';
import { expect, test } from 'vitest';

import { PptxViewer } from './PptxViewer';

test('marks the find matches on the editing canvas and moves the current one with Next', async () => {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const viewer = new PptxViewer(container, { editable: true });
	const { handler, data } = await PptxHandler.create({ initialSlideCount: 1 });
	data.slides[0].elements.push(createTextElement('hello there, hello'));
	try {
		await viewer.loadFile(await handler.save(data.slides));
		const find = viewer.editor.getFindReplaceActions();
		expect(find.search('hello', false)).toBe(2);
		expect(viewer.store.get().findMatches).toHaveLength(2);
		const marks = () =>
			[...container.querySelectorAll<HTMLElement>('mark[data-pptx-find-match]')]
				.filter((mark) => mark.closest('[data-pptx-element="true"]'))
				.map((mark) => [mark.dataset['pptxFindMatch'], mark.textContent]);
		expect(marks()).toStrictEqual([
			['current', 'hello'],
			['match', 'hello'],
		]);
		find.next!();
		expect(viewer.store.get().findCurrent).toBe(1);
		expect(marks()).toStrictEqual([
			['match', 'hello'],
			['current', 'hello'],
		]);
		find.close!();
		expect(container.querySelectorAll('mark[data-pptx-find-match]')).toHaveLength(0);
	} finally {
		viewer.destroy();
		handler.dispose();
		container.remove();
	}
});
