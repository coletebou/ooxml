// A message is shown in its own direction and language: an HTML message in those its html element
// and body give, its quotes barred on the side its lines start on, and a plain-text one paragraph
// by paragraph in the direction of its own text.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { emlHeader, importEml, importHtmlMail, openConversation, openDemo } from './helpers';

/** "Hello, world" in Arabic, which is written right to left. */
const ARABIC = 'مرحبا بالعالم';

/** The document of the open message. */
const message = (page: Page) => page.frameLocator('mail-reading-pane mail-html-frame iframe');

/** The attributes of `element`, by name. */
const attributesOf = (element: Element): Record<string, string> =>
	Object.fromEntries([...element.attributes].map(({ name, value }) => [name, value]));

/**
 * The side of `element` the text `needle` in it starts from: the one it lies nearer to, read
 * from where the browser drew it.
 */
const sideOf = (element: Locator, needle: string): Promise<'left' | 'right'> =>
	element.evaluate((box, needle) => {
		const doc = box.ownerDocument;
		const walker = doc.createTreeWalker(box, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const at = node.textContent?.indexOf(needle) ?? -1;
			if (at < 0) continue;
			const range = doc.createRange();
			range.setStart(node, at);
			range.setEnd(node, at + needle.length);
			const text = range.getBoundingClientRect();
			const edges = box.getBoundingClientRect();
			return text.left - edges.left < edges.right - text.right ? 'left' : 'right';
		}
		throw new Error(`"${needle}" is not shown`);
	}, needle);

test('an HTML message is shown in the direction and language its html element or body gives', async ({
	page,
}) => {
	await openDemo(page);
	await importHtmlMail(page, [
		{
			subject: 'Written right to left',
			html: `<html dir="rtl" lang="ar"><body><p>${ARABIC}</p><blockquote>${ARABIC}</blockquote></body></html>`,
		},
		{ subject: 'Body in Arabic', html: `<body dir="rtl" lang="ar"><p>${ARABIC}</p></body>` },
	]);
	await openConversation(page, 'Written right to left');
	const paragraph = message(page).locator('p');
	await expect(paragraph).toHaveText(ARABIC);
	expect(await message(page).locator('html').evaluate(attributesOf)).toEqual({
		dir: 'rtl',
		lang: 'ar',
	});
	expect(await sideOf(paragraph, ARABIC)).toBe('right');
	// The bar of a quote is on the side its lines start on.
	const quote = message(page).locator('blockquote');
	const borders = await quote.evaluate((element) => {
		const style = getComputedStyle(element);
		return [style.borderRightStyle, style.borderLeftStyle];
	});
	expect(borders).toEqual(['solid', 'none']);
	expect(await sideOf(quote, ARABIC)).toBe('right');
	// A body that gives them gives them to what it holds.
	await openConversation(page, 'Body in Arabic');
	await expect(paragraph).toHaveText(ARABIC);
	expect(await message(page).locator('body').evaluate(attributesOf)).toEqual({
		dir: 'rtl',
		lang: 'ar',
	});
	expect(await sideOf(paragraph, ARABIC)).toBe('right');
});

test('a message sent in several HTML parts takes the direction and language of its parts read as one', async ({
	page,
}) => {
	await openDemo(page);
	const parts = [
		`<html dir="rtl"><body lang="ar"><p>${ARABIC}</p></body></html>`,
		'<html dir="ltr" lang="en"><body dir="ltr" lang="fr"><p>Second part</p></body></html>',
	];
	await importEml(page, 'Direction in parts', [
		...emlHeader('Direction in parts', 'multipart/mixed; boundary=part'),
		...parts.flatMap((part) => ['--part', 'Content-Type: text/html; charset=utf-8', '', part]),
		'--part--',
		'',
	]);
	await openConversation(page, 'Direction in parts');
	await expect(message(page).locator('p')).toHaveCount(2);
	// What this browser makes of the parts joined into one text.
	const joined = await page.evaluate((html) => {
		const doc = new DOMParser().parseFromString(html, 'text/html');
		const of = (element: Element) =>
			Object.fromEntries([...element.attributes].map(({ name, value }) => [name, value]));
		return { root: of(doc.documentElement), body: of(doc.body) };
	}, parts.join(''));
	expect(joined).toEqual({ root: { dir: 'rtl', lang: 'en' }, body: { lang: 'ar', dir: 'ltr' } });
	expect(await message(page).locator('html').evaluate(attributesOf)).toEqual(joined.root);
	expect(await message(page).locator('body').evaluate(attributesOf)).toEqual(joined.body);
});

test('a plain-text message is shown paragraph by paragraph in the direction of its own text', async ({
	page,
}) => {
	await openDemo(page);
	await importEml(page, 'Plain text both ways', [
		...emlHeader('Plain text both ways', 'text/plain; charset=utf-8'),
		ARABIC,
		'Hello, world',
		'',
	]);
	await openConversation(page, 'Plain text both ways');
	const text = page.locator('mail-reading-pane .text');
	await expect(text).toContainText('Hello, world');
	expect(await sideOf(text, ARABIC)).toBe('right');
	expect(await sideOf(text, 'Hello, world')).toBe('left');
});

test('a reply to a message written right to left quotes it right to left', async ({ page }) => {
	await openDemo(page);
	await importHtmlMail(page, [
		{
			subject: 'Quoted right to left',
			html: `<html dir="rtl" lang="ar"><body><p>${ARABIC}</p></body></html>`,
		},
	]);
	await openConversation(page, 'Quoted right to left');
	await expect(message(page).locator('p')).toHaveText(ARABIC);
	await page.keyboard.press('r');
	const quote = page.locator('mail-compose .editor blockquote[type="cite"]');
	await expect(quote).toContainText(ARABIC);
	expect(await sideOf(quote, ARABIC)).toBe('right');
	expect(await quote.locator('[lang="ar"]').count()).toBe(1);
});
