/* oxlint-disable vitest/prefer-importing-vitest-globals -- Playwright spec, `test`/`expect` come from @playwright/test */
/**
 * The new-comment box keeps a margin inside the panel it is drawn on, in every binding (desktop).
 *
 * A pane of its own pads itself; a pane inside a titled surface (an inspector tab) draws no box and
 * the surface frames it. The viewer's scoped preflight is a document rule, which beats the shared
 * pane's own `:host` padding, so the pane's content once sat flush against its edges in all five.
 *
 * Run: bunx playwright test comments-pane-inset
 */
import { expect, test } from '@playwright/test';

import {
	addCommentViaContextMenu,
	composeBoxInset,
	ensureCommentsListShowing,
} from './support/comments';
import { loadDeck, SAMPLE_DECK, slideElements } from './support/deck';

const TEXT = 'Inset check';

test('the new-comment box keeps a margin inside the panel it is drawn on', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await loadDeck(page, SAMPLE_DECK);
	const shape = slideElements(page).filter({ hasText: 'Product Overview' }).first();
	await shape.waitFor();
	await addCommentViaContextMenu(page, shape, TEXT);
	await ensureCommentsListShowing(page, TEXT);
	await expect
		.poll(() => composeBoxInset(page))
		.toMatchObject({
			start: expect.any(Number),
			end: expect.any(Number),
		});
	const inset = (await composeBoxInset(page))!;
	expect(inset.start).toBeGreaterThanOrEqual(8);
	expect(inset.end).toBeGreaterThanOrEqual(8);
});
