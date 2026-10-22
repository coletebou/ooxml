// Files dropped, pasted or inserted on a page become containers: pictures at their natural size
// (scaled down to fit), Office files as live embeds, anything else as a card. Several files cascade
// from the drop point so none hides another.
import {
	type BinaryItemInput,
	MAX_CONTAINER_WIDTH,
	MAX_FILE_BYTES,
	MIN_CONTAINER_WIDTH,
	isImageMime,
} from 'ooxml-core/notebook';
import { detectOfficeKind } from 'ooxml-core/opc';

export interface PlacedFile {
	kind: 'image' | 'file';
	input: BinaryItemInput;
}

export interface PlacedFiles {
	placed: PlacedFile[];
	/** Files refused for being over `MAX_FILE_BYTES`; none of them was read. */
	tooLarge: number;
}

const MAX_PICTURE_WIDTH = 480;
const CASCADE = 24;

async function pictureSize(blob: Blob): Promise<{ width: number; height: number }> {
	try {
		const bitmap = await createImageBitmap(blob);
		const size = { width: bitmap.width, height: bitmap.height };
		bitmap.close();
		if (size.width > 0 && size.height > 0) return size;
	} catch {
		// SVG and some formats cannot be decoded this way; fall back to a default frame.
	}
	return { width: 320, height: 240 };
}

/** The mime type, guessed from the name when the platform gave none. */
/**
 * The frame a picture of `natural` size is placed in: at most `MAX_PICTURE_WIDTH` wide and at least
 * the smallest frame, scaled by one factor so it keeps its shape (Word export draws it at this size).
 */
export function pictureFrame(natural: { width: number; height: number }): {
	width: number;
	height: number;
} {
	const w = Math.max(1, natural.width);
	const h = Math.max(1, natural.height);
	// Never wider than a frame can be, where the core would clamp it out of shape.
	const scale = Math.min(
		Math.max(Math.min(1, MAX_PICTURE_WIDTH / w), MIN_CONTAINER_WIDTH / w, 16 / h),
		MAX_CONTAINER_WIDTH / w,
	);
	return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

export function mimeOf(file: { name: string; type: string }): string {
	if (file.type) return file.type;
	const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
	const images: Record<string, string> = {
		png: 'image/png',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		gif: 'image/gif',
		webp: 'image/webp',
		bmp: 'image/bmp',
		svg: 'image/svg+xml',
	};
	return images[ext] ?? 'application/octet-stream';
}

/**
 * Where something new goes when no point was given: below what is already on the page. A text box
 * grows with its content, so `drawn` (heights measured on screen, by container id) wins over the
 * stored height.
 */
export function belowContent(
	containers: readonly { id: string; y: number; height: number }[],
	drawn: ReadonlyMap<string, number> = new Map(),
): { x: number; y: number } {
	if (!containers.length) return { x: 48, y: 24 };
	const bottom = Math.max(...containers.map((c) => c.y + (drawn.get(c.id) || c.height || 96)));
	return { x: 48, y: Math.round(bottom + 24) };
}

export async function placeFiles(
	files: readonly File[],
	at: { x: number; y: number },
): Promise<PlacedFiles> {
	const out: PlacedFile[] = [];
	let tooLarge = 0;
	for (const file of files) {
		if (file.size > MAX_FILE_BYTES) {
			tooLarge++;
			continue;
		}
		const mime = mimeOf(file);
		const bytes = new Uint8Array(await file.arrayBuffer());
		// Cascade by what is placed, so a refused file leaves no gap.
		const x = Math.round(at.x + out.length * CASCADE);
		const y = Math.round(at.y + out.length * CASCADE);
		if (isImageMime(mime)) {
			const frame = pictureFrame(await pictureSize(file));
			out.push({
				kind: 'image',
				input: {
					x,
					y,
					...frame,
					name: file.name || 'picture.png',
					mime,
					bytes,
				},
			});
		} else {
			const live = detectOfficeKind(file.name, mime) !== 'other';
			out.push({
				kind: 'file',
				input: {
					x,
					y,
					width: live ? 640 : 360,
					height: live ? 460 : 48,
					name: file.name || 'file',
					mime,
					bytes,
				},
			});
		}
	}
	return { placed: out, tooLarge };
}
