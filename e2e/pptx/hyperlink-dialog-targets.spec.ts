/* oxlint-disable vitest/prefer-importing-vitest-globals -- Playwright spec */
/**
 * Insert > Link edits a shape's hyperlink through the same targets in every binding (the shared
 * `hyperlink-edit-target` model): the dialog opens on the shape's own link, a slide picked on the
 * Slide tab saves a jump to that slide's part and reopens on it, and an email address with a
 * subject saves a mailto link. The dialog is found by its name, its tabs by theirs and every
 * field by its label, the contract all five bindings share.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import JSZip from 'jszip';
import type { PowerPointViewerAPI } from 'pptx-viewer-shared';

import { savePptxViaBackstage } from './save-pptx';
import {
	elementWithText,
	resetTabSession,
	ribbon,
	selectElement,
	slideStage,
} from './support/deck';

declare global {
	interface Window {
		/** Public component handle exposed by each development demo. */
		__pptxViewer: PowerPointViewerAPI;
	}
}

// One slide; its rectangle "Linked Shape" links to https://example.com/hyperlink-fixture.
const fixture = fileURLToPath(new URL('./fixtures/hyperlink-action.pptx', import.meta.url));
const LOADED_URL = 'https://example.com/hyperlink-fixture';

/** The fixture with two blank slides after its own, the first one active. */
async function openThreeSlideDeck(page: Page): Promise<void> {
	await resetTabSession(page);
	await page.goto('/');
	await page.locator('#file-input').setInputFiles(fixture);
	await expect(slideStage(page)).toBeVisible();
	for (const count of [2, 3]) {
		await page.evaluate((after) => window.__pptxViewer.addSlide(after), count - 2);
		await expect.poll(() => page.evaluate(() => window.__pptxViewer.getSlideCount())).toBe(count);
	}
	await page.evaluate(() => window.__pptxViewer.setActiveSlideIndex(0));
	await expect.poll(() => page.evaluate(() => window.__pptxViewer.getActiveSlideIndex())).toBe(0);
	await expect(elementWithText(page, 'Linked Shape')).toBeVisible();
}

async function openLinkDialog(page: Page): Promise<Locator> {
	await selectElement(page, elementWithText(page, 'Linked Shape'));
	await ribbon(page).getByRole('tab', { name: 'Insert', exact: true }).click();
	await ribbon(page).getByRole('button', { name: 'Link', exact: true }).first().click();
	const dialog = page.getByRole('dialog', { name: 'Edit Hyperlink' });
	await expect(dialog).toBeVisible();
	return dialog;
}

const tab = (dialog: Locator, name: string) => dialog.getByRole('button', { name, exact: true });
const field = (dialog: Locator, label: string) => dialog.getByLabel(label, { exact: true });

async function apply(dialog: Locator): Promise<void> {
	await dialog.getByRole('button', { name: /^(Apply|OK)$/u }).click();
	await expect(dialog).toBeHidden();
}

/** Save through File: the first slide's `a:hlinkClick` and its target, and the slide parts in deck order. */
async function savedLink(
	page: Page,
): Promise<{ action: string | undefined; target: string | undefined; slides: string[] }> {
	const download = await savePptxViaBackstage(page);
	const zip = await JSZip.loadAsync(await readFile((await download.path())!));
	const text = (name: string) => zip.file(name)!.async('string');
	const target = (rels: string, id: string) =>
		/Target="([^"]*)"/u.exec(
			new RegExp(`<Relationship [^>]*Id="${id}"[^>]*>`, 'u').exec(rels)?.[0] ?? '',
		)?.[1];
	const [presentation, presentationRels] = await Promise.all([
		text('ppt/presentation.xml'),
		text('ppt/_rels/presentation.xml.rels'),
	]);
	const slides = [...presentation.matchAll(/<p:sldId [^>]*r:id="([^"]+)"/gu)].map(([, id]) =>
		(target(presentationRels, id!) ?? '').replace(/^.*\//u, ''),
	);
	const [xml, rels] = await Promise.all([
		text(`ppt/slides/${slides[0]}`),
		text(`ppt/slides/_rels/${slides[0]}.rels`),
	]);
	const link = /<a:hlinkClick[^>]*>/u.exec(xml)?.[0] ?? '';
	const rId = /r:id="([^"]*)"/u.exec(link)?.[1];
	return {
		action: /action="([^"]*)"/u.exec(link)?.[1],
		target: rId ? target(rels, rId) : undefined,
		slides,
	};
}

test('a slide picked on the Slide tab saves a jump to that slide and reopens on it', async ({
	page,
}) => {
	await openThreeSlideDeck(page);
	const dialog = await openLinkDialog(page);
	// The dialog opens on the shape's own link.
	await expect(tab(dialog, 'URL')).toHaveAttribute('aria-pressed', 'true');
	await expect(field(dialog, 'Address')).toHaveValue(LOADED_URL);

	await tab(dialog, 'Slide').click();
	await expect(tab(dialog, 'Slide')).toHaveAttribute('aria-pressed', 'true');
	await field(dialog, 'Slide number').fill('3');
	await apply(dialog);

	const saved = await savedLink(page);
	expect(saved.slides).toHaveLength(3);
	expect(saved.action).toBe('ppaction://hlinksldjump');
	expect(saved.target).toBe(saved.slides[2]);

	const reopened = await openLinkDialog(page);
	await expect(tab(reopened, 'Slide')).toHaveAttribute('aria-pressed', 'true');
	await expect(field(reopened, 'Slide number')).toHaveValue('3');
});

test('an email address and subject save a mailto link', async ({ page }) => {
	await openThreeSlideDeck(page);
	const dialog = await openLinkDialog(page);
	await tab(dialog, 'Email').click();
	await field(dialog, 'Email address').fill('team@example.com');
	await field(dialog, 'Subject').fill('Q1 review');
	await apply(dialog);

	const saved = await savedLink(page);
	expect(saved.action).toBeUndefined();
	expect(saved.target).toBe('mailto:team@example.com?subject=Q1%20review');
});
