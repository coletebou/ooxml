// @vitest-environment jsdom
import type { MailAttachment } from 'ooxml-core/mail';
import { InlineImages, KEPT_MESSAGES, type PictureMessage } from './inline-images';

afterEach(() => vi.unstubAllGlobals());

/** A message whose body shows one PNG part, `<id>@x`, read from blob `blobId`. */
function picture(id: string, blobId = `${id}-blob`): PictureMessage {
	const part: MailAttachment = {
		partId: '2',
		blobId,
		name: 'picture.png',
		type: 'image/png',
		size: 2,
		disposition: 'inline',
		cid: `${id}@x`,
	};
	return { id, html: `<img src="cid:${id}@x">`, attachments: [part] };
}

/** Object URLs (jsdom has none) for the rest of the test, recording how many were made and revoked. */
function objectUrls() {
	const revoked: string[] = [];
	let made = 0;
	vi.stubGlobal(
		'URL',
		Object.assign(class extends URL {}, {
			createObjectURL: () => `blob:test/${++made}`,
			revokeObjectURL: (url: string) => void revoked.push(url),
		}),
	);
	return { revoked, made: () => made };
}

const bytes = async () => new Uint8Array([1, 2]);

describe('InlineImages', () => {
	it('reads a message again when its parts changed, revoking the old pictures', async () => {
		const urls = objectUrls();
		const download = vi.fn(bytes);
		const images = new InlineImages(download, () => new Set());
		const first = await images.urls(picture('a'));
		expect(await images.urls(picture('a'))).toBe(first);
		expect(download).toHaveBeenCalledTimes(1);
		const again = await images.urls(picture('a', 'other-blob'));
		expect([first.get('a@x'), again.get('a@x')]).toEqual(['blob:test/1', 'blob:test/2']);
		expect(urls.revoked).toEqual(['blob:test/1']);
	});

	it('drops a picture that arrives once its message was let go', async () => {
		const urls = objectUrls();
		let finish: (bytes: Uint8Array) => void = () => {};
		const images = new InlineImages(
			() => new Promise((resolve) => (finish = resolve)),
			() => new Set(),
		);
		const pending = images.urls(picture('a'));
		images.clear();
		finish(new Uint8Array([1]));
		expect((await pending).size).toBe(0);
		expect(urls.made()).toBe(0);
	});

	it('lets the least recently used messages go, never one on screen', async () => {
		const urls = objectUrls();
		const images = new InlineImages(bytes, () => new Set(['shown']));
		const shown = (await images.urls(picture('shown'))).get('shown@x')!;
		const reused = (await images.urls(picture('reused'))).get('reused@x')!;
		const older = (await images.urls(picture('older'))).get('older@x')!;
		for (let i = 0; i < KEPT_MESSAGES - 3; i++) await images.urls(picture(`m${i}`));
		// Full: using one again makes it the most recent, and the next new message lets one go.
		await images.urls(picture('reused'));
		await images.urls(picture('new'));
		expect(urls.revoked).toEqual([older]);
		expect(urls.revoked).not.toContain(shown);
		expect(urls.revoked).not.toContain(reused);
	});

	it('downloads the pictures every part of the body shows, as it is shown part by part', async () => {
		objectUrls();
		const download = vi.fn(bytes);
		const images = new InlineImages(download, () => new Set());
		// Read as one text, the comment the first part leaves open would hide the picture.
		const message = picture('parts');
		const htmlParts = ['<p>Hello<!--', message.html!];
		const urls = await images.urls({ ...message, html: htmlParts.join(''), htmlParts });
		expect([...urls.keys()]).toEqual(['parts@x']);
		expect(download).toHaveBeenCalledTimes(1);
	});

	it('keeps every message on screen, however many, and nothing for a body without pictures', async () => {
		const urls = objectUrls();
		const download = vi.fn(bytes);
		const ids = Array.from({ length: KEPT_MESSAGES * 2 }, (_, i) => `m${i}`);
		const images = new InlineImages(download, () => new Set(['plain', ...ids]));
		for (const id of ids) await images.urls(picture(id));
		expect(urls.revoked).toEqual([]);
		const plain = { ...picture('plain'), html: '<p>No pictures here.</p>' };
		expect((await images.urls(plain)).size).toBe(0);
		expect(download).toHaveBeenCalledTimes(ids.length);
	});
});
