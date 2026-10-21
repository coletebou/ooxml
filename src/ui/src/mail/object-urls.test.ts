import { decodeBase64 } from 'ooxml-core/digest';
import { activeType, downloadBytes, imageUrl } from './object-urls';

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

const svg = new TextEncoder().encode(
	'<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>',
);

/** The blobs `URL.createObjectURL` is asked for from now on. */
function blobs(): Blob[] {
	const made: Blob[] = [];
	vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
		made.push(blob as Blob);
		return `blob:test/${made.length}`;
	});
	return made;
}

describe('object URLs of message parts', () => {
	it('knows the types a browser could open as a page that runs script', () => {
		for (const type of [
			'text/html',
			'image/svg+xml',
			'IMAGE/SVG+XML',
			'application/xhtml+xml',
			'text/xml',
			'application/xml',
			'application/rss+xml',
			'text/xsl',
			'multipart/x-mixed-replace',
			'text/html; charset=utf-8',
		])
			expect(activeType(type), type).toBe(true);
		// A browser guesses the type of bytes without a valid one, and may find HTML.
		for (const type of ['', 'image', 'image/svg+xml,x', 'unknown/unknown', '*/*', 'image/ png'])
			expect(activeType(type), type).toBe(true);
		for (const type of [
			'image/png',
			'image/jpeg',
			'application/pdf',
			'text/plain; charset=utf-8',
			'text/calendar',
			'message/rfc822',
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		])
			expect(activeType(type), type).toBe(false);
	});

	it('shows an SVG picture from a data: URL and a PNG from a blob', async () => {
		const made = blobs();
		const url = imageUrl(svg, 'image/svg+xml');
		expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
		expect(decodeBase64(url.slice(url.indexOf(',') + 1))).toEqual(svg);
		// A type that is not valid is shown as bytes, which an image element still reads.
		expect(imageUrl(svg, 'image/svg+xml,x')).toMatch(/^data:application\/octet-stream;base64,/);
		expect(made).toEqual([]);
		expect(imageUrl(new Uint8Array([1, 2]), 'image/png')).toBe('blob:test/1');
		expect(made[0]!.type).toBe('image/png');
		expect(new Uint8Array(await made[0]!.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
		// The blob gets the type as checked: a browser can read no other one from it.
		imageUrl(new Uint8Array([1]), ' IMAGE/PNG\n; name=x');
		expect(made[1]!.type).toBe('image/png');
	});

	it('downloads a file of a type that could run script as plain bytes', () => {
		vi.useFakeTimers();
		const made = blobs();
		const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		const links: HTMLAnchorElement[] = [];
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
			this: HTMLAnchorElement,
		) {
			links.push(this);
		});
		downloadBytes(document, svg, 'logo.svg', 'image/svg+xml');
		downloadBytes(document, new Uint8Array([1]), 'report.pdf', 'application/pdf');
		expect(made.map((blob) => blob.type)).toEqual(['application/octet-stream', 'application/pdf']);
		expect(links.map((link) => [link.download, link.href])).toEqual([
			['logo.svg', 'blob:test/1'],
			['report.pdf', 'blob:test/2'],
		]);
		vi.advanceTimersByTime(30_000);
		expect(revoke.mock.calls).toEqual([['blob:test/1'], ['blob:test/2']]);
	});
});
