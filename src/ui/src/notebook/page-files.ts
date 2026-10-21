// Files dropped, pasted or inserted on a page become containers: pictures at their natural size
// (scaled down to fit), Office files as live embeds, anything else as a card. Several files cascade
// from the drop point so none hides another.
import { type BinaryItemInput, isImageMime } from 'ooxml-core/notebook';
import { detectOfficeKind } from 'ooxml-core/opc';

export interface PlacedFile {
	kind: 'image' | 'file';
	input: BinaryItemInput;
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

export async function placeFiles(
	files: readonly File[],
	at: { x: number; y: number },
): Promise<PlacedFile[]> {
	const out: PlacedFile[] = [];
	for (const [i, file] of files.entries()) {
		const mime = mimeOf(file);
		const bytes = new Uint8Array(await file.arrayBuffer());
		const x = Math.round(at.x + i * CASCADE);
		const y = Math.round(at.y + i * CASCADE);
		if (isImageMime(mime)) {
			const natural = await pictureSize(file);
			const scale = Math.min(1, MAX_PICTURE_WIDTH / natural.width);
			out.push({
				kind: 'image',
				input: {
					x,
					y,
					width: Math.max(40, Math.round(natural.width * scale)),
					height: Math.max(16, Math.round(natural.height * scale)),
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
	return out;
}
