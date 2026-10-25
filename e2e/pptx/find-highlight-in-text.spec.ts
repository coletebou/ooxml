/* oxlint-disable vitest/prefer-importing-vitest-globals -- Playwright owns the test globals */
/**
 * Find matches marked inside the slide text, in every binding.
 *
 * ## The drift this pins
 *
 * Only React drew the find bar's matches inside the text; Vue, Angular,
 * Svelte and vanilla held the same session and marked nothing, so a match was
 * shown only by the bar's count and the slide it moved to. The grouping and
 * the run cut now live once in `src/ui/src/pptx/render/find-highlights.ts`,
 * and each binding wraps a matched run in `mark[data-pptx-find-match]`
 * (`current` for the bar's own match, `match` for the others).
 *
 * The sample deck has three matches of "quarter" on two slides: "Quarterly
 * growth" in the agenda (slide 2), and the "Quarterly Growth" title and the
 * "by quarter" subtitle of the chart slide (slide 3).
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { loadDeck } from './support/deck';
import { armKeyboard } from './support/keyboard';

test.use({ viewport: { width: 1440, height: 900 } });

/**
 * Each mark on the page, with whether it sits in an element of the editing canvas. Read through a
 * locator, which pierces open shadow roots (`page.evaluate`'s `document` queries would not).
 */
function marks(page: Page) {
	return page.locator('mark[data-pptx-find-match]').evaluateAll((nodes) =>
		nodes.map((mark) => ({
			kind: (mark as HTMLElement).dataset['pptxFindMatch'],
			text: mark.textContent,
			onCanvas: Boolean(mark.closest('[data-pptx-element="true"]')),
		})),
	);
}

async function openFindReplace(page: Page): Promise<void> {
	await armKeyboard(page);
	await page.keyboard.press('Control+h');
	await expect(page.locator('input[placeholder*="Find" i]').first()).toBeVisible();
}

test('marks the matches inside the text, the current one apart, and clears them on close', async ({
	page,
}) => {
	await loadDeck(page);
	await openFindReplace(page);
	await page.locator('input[placeholder*="Find" i]').first().fill('quarter');

	// The first match is on the agenda: the search goes there and marks it.
	await expect
		.poll(() => marks(page))
		.toEqual([{ kind: 'current', text: 'Quarter', onCanvas: true }]);

	// Next goes to the chart slide: both of its matches are marked, the title's current.
	await page.getByRole('button', { name: 'Next match', exact: true }).first().click();
	await expect
		.poll(() => marks(page))
		.toEqual([
			{ kind: 'current', text: 'Quarter', onCanvas: true },
			{ kind: 'match', text: 'quarter', onCanvas: true },
		]);
	const current = page.locator('mark[data-pptx-find-match="current"]').first();
	const other = page.locator('mark[data-pptx-find-match="match"]').first();
	const fill = (mark: typeof current) =>
		mark.evaluate((node) => getComputedStyle(node).backgroundColor);
	expect(await fill(current)).not.toBe(await fill(other));

	// Next moves the mark to the subtitle's match.
	await page.getByRole('button', { name: 'Next match', exact: true }).first().click();
	await expect
		.poll(() => marks(page))
		.toEqual([
			{ kind: 'match', text: 'Quarter', onCanvas: true },
			{ kind: 'current', text: 'quarter', onCanvas: true },
		]);

	await page.getByRole('button', { name: /^Close find (?:and replace|bar)$/u }).click();
	await expect.poll(() => marks(page)).toEqual([]);
});
