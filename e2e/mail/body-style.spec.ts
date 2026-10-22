// An HTML message is shown on the styling of its own body: its style, the colours its attributes
// give it and its picture, cleaned and blocked as they are anywhere else in a message.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { emlHeader, importEml, importHtmlMail, openConversation, openDemo } from './helpers';

/** A one-pixel PNG, for the picture a body is shown on. */
const PIXEL =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** The document of the open message. */
const message = (page: Page) => page.frameLocator('mail-reading-pane mail-html-frame iframe');

/** The value of the CSS `property` the first element `selector` finds in the open message has. */
const shownWith = (page: Page, selector: string, property: string): Promise<string> =>
	message(page)
		.locator(selector)
		.first()
		.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);

/** The attributes of `element`, by name. */
const attributesOf = (element: Element): Record<string, string> =>
	Object.fromEntries([...element.attributes].map(({ name, value }) => [name, value]));

/**
 * The colour on screen of the pixel `inset` pixels in from the middle of the top or bottom edge of
 * `target`, read from a screenshot of it.
 */
async function edgePixel(page: Page, target: Locator, edge: 'top' | 'bottom', inset: number) {
	const png = (await target.screenshot()).toString('base64');
	return page.evaluate(
		async ({ png, edge, inset }) => {
			const image = new Image();
			image.src = `data:image/png;base64,${png}`;
			await image.decode();
			const canvas = document.createElement('canvas');
			canvas.width = image.width;
			canvas.height = image.height;
			const context = canvas.getContext('2d')!;
			context.drawImage(image, 0, 0);
			const y = edge === 'top' ? inset : image.height - 1 - inset;
			const [r, g, b] = context.getImageData(Math.floor(image.width / 2), y, 1, 1).data;
			return `rgb(${r}, ${g}, ${b})`;
		},
		{ png, edge, inset },
	);
}

test('an HTML message is shown on the background of its own body, which fills its frame', async ({
	page,
}) => {
	await openDemo(page);
	await importHtmlMail(page, [
		{
			subject: 'Dark body',
			html: '<body style="background:#000"><p style="color:#fff">Light text</p></body>',
		},
	]);
	await openConversation(page, 'Dark body');
	await expect(message(page).locator('p')).toHaveText('Light text');
	// The frame's own body has it, so it fills the padding round the message too.
	const frame = page.locator('mail-reading-pane mail-html-frame iframe').first();
	await expect.poll(() => edgePixel(page, frame, 'top', 2)).toBe('rgb(0, 0, 0)');
	expect(await edgePixel(page, frame, 'bottom', 2)).toBe('rgb(0, 0, 0)');
	expect(await shownWith(page, 'body', 'background-color')).toBe('rgb(0, 0, 0)');
	expect(await shownWith(page, 'p', 'color')).toBe('rgb(255, 255, 255)');
});

test('an HTML message is shown in the colours its body attributes give, its style sheets winning', async ({
	page,
}) => {
	await openDemo(page);
	await importHtmlMail(page, [
		{
			subject: 'Coloured body',
			html: '<body bgcolor="102030" text="#eeeeee" link="#ffcc00"><p>Light text and <a href="https://example.com/">a link</a></p></body>',
		},
		{
			subject: 'Sheet over body',
			html: '<style>body{background:#fafafa;color:#333}</style><body bgcolor="#000000" text="#ffffff"><p>Dark text</p></body>',
		},
	]);
	await openConversation(page, 'Coloured body');
	await expect(message(page).locator('p')).toContainText('Light text');
	// A colour written as old HTML writes it, without its `#`, is read as a browser reads it.
	expect(await shownWith(page, 'body', 'background-color')).toBe('rgb(16, 32, 48)');
	expect(await shownWith(page, 'body', 'color')).toBe('rgb(238, 238, 238)');
	expect(await shownWith(page, 'a', 'color')).toBe('rgb(255, 204, 0)');
	// The message's own style sheet wins over its body's attributes, as it does in a browser.
	await openConversation(page, 'Sheet over body');
	await expect(message(page).locator('p')).toHaveText('Dark text');
	expect(await shownWith(page, 'body', 'background-color')).toBe('rgb(250, 250, 250)');
	expect(await shownWith(page, 'body', 'color')).toBe('rgb(51, 51, 51)');
});

test('a remote picture of a message body is blocked and counted until images are shown', async ({
	page,
	context,
}) => {
	const asked: string[] = [];
	await context.route('https://images.example.com/**', (route) => {
		asked.push(route.request().url());
		return route.fulfill({ contentType: 'image/png', body: Buffer.from(PIXEL, 'base64') });
	});
	await openDemo(page);
	await importHtmlMail(page, [
		{
			subject: 'Body picture',
			html: '<body background="https://images.example.com/paper.png" bgcolor="#202020" text="#ffffff"><p>On a picture</p></body>',
		},
	]);
	await openConversation(page, 'Body picture');
	const banner = page.locator('mail-reading-pane .remote');
	await expect(banner).toContainText('Blocked 1 remote image');
	await expect(message(page).locator('p')).toHaveText('On a picture');
	expect(await shownWith(page, 'body', 'background-image')).toBe('none');
	expect(await shownWith(page, 'body', 'background-color')).toBe('rgb(32, 32, 32)');
	expect(asked).toEqual([]);
	await banner.getByRole('button', { name: 'Show images' }).click();
	await expect(banner).toHaveCount(0);
	await expect
		.poll(() => shownWith(page, 'body', 'background-image'))
		.toBe('url("https://images.example.com/paper.png")');
	await expect.poll(() => asked).toContain('https://images.example.com/paper.png');
});

test('a message sent in several HTML parts is styled as its parts read as one document', async ({
	page,
}) => {
	await openDemo(page);
	const parts = [
		'<html><body bgcolor="#000000" text="#ffffff"><p>First part</p></body></html>',
		'<html><body bgcolor="#ffffff" text="#000000" link="#ffcc00"><p>Second part and <a href="https://example.com/">a link</a></p></body></html>',
	];
	await importEml(page, 'Body in parts', [
		...emlHeader('Body in parts', 'multipart/mixed; boundary=part'),
		...parts.flatMap((part) => ['--part', 'Content-Type: text/html; charset=utf-8', '', part]),
		'--part--',
		'',
	]);
	await openConversation(page, 'Body in parts');
	await expect(message(page).locator('p')).toHaveCount(2);
	expect(await shownWith(page, 'body', 'background-color')).toBe('rgb(0, 0, 0)');
	expect(await shownWith(page, 'body', 'color')).toBe('rgb(255, 255, 255)');
	expect(await shownWith(page, 'a', 'color')).toBe('rgb(255, 204, 0)');
	// The attributes this browser gives the body of the parts joined into one text.
	const joined = await page.evaluateHandle(
		(html) => new DOMParser().parseFromString(html, 'text/html').body,
		parts.join(''),
	);
	expect(await message(page).locator('body').evaluate(attributesOf)).toEqual(
		await joined.evaluate(attributesOf),
	);
});
