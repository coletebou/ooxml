import { MAX_FILE_BYTES } from 'ooxml-core/notebook';
import { belowContent, mimeOf, pictureFrame, placeFiles } from './page-files';

const file = (name: string, size: number, type = ''): File =>
	({
		name,
		size,
		type,
		arrayBuffer: async () => {
			if (size > MAX_FILE_BYTES) throw new Error('an oversized file must not be read');
			return new Uint8Array(size).buffer;
		},
	}) as unknown as File;

describe('placing files on a page', () => {
	it('refuses oversized files before reading them and cascades the rest', async () => {
		const { placed, tooLarge } = await placeFiles(
			[file('big.bin', MAX_FILE_BYTES + 1), file('Budget.xlsx', 10), file('notes.txt', 4)],
			{ x: 100, y: 50 },
		);
		expect(tooLarge).toBe(1);
		expect(placed.map((p) => [p.kind, p.input.name, p.input.x, p.input.y, p.input.width])).toEqual([
			['file', 'Budget.xlsx', 100, 50, 640],
			['file', 'notes.txt', 124, 74, 360],
		]);
	});

	it('guesses picture types from the name and places new items below the content', () => {
		expect(mimeOf({ name: 'a.JPG', type: '' })).toBe('image/jpeg');
		expect(mimeOf({ name: 'a.bin', type: 'text/plain' })).toBe('text/plain');
		expect(belowContent([])).toEqual({ x: 48, y: 24 });
		const containers = [
			{ id: 'text', y: 100, height: 0 },
			{ id: 'picture', y: 20, height: 300 },
		];
		expect(belowContent(containers)).toEqual({ x: 48, y: 344 });
		// A text box drawn taller than its stored height pushes new items below what it shows.
		expect(belowContent(containers, new Map([['text', 400]]))).toEqual({ x: 48, y: 524 });
	});

	it('frames a picture in its own shape, small and large', () => {
		expect(pictureFrame({ width: 10, height: 10 })).toEqual({ width: 40, height: 40 });
		expect(pictureFrame({ width: 960, height: 480 })).toEqual({ width: 480, height: 240 });
		expect(pictureFrame({ width: 200, height: 100 })).toEqual({ width: 200, height: 100 });
		// A thin strip keeps its shape at the smallest height.
		expect(pictureFrame({ width: 400, height: 4 })).toEqual({ width: 1600, height: 16 });
	});
});
