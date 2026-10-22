// The rasteriser the page export hands the core (`PageExportOptions.rasterize`): ink becomes a PNG
// drawn from the same outlines the page shows, and pictures Word cannot show (WebP, SVG) are
// re-encoded as PNG, in their own shape within their frame as the page shows them. Drawn at twice the CSS size so they stay sharp when printed.
import { containRect } from 'ooxml-core/geometry';
import { type ExportPicture, type RasterRequest, inkOutline } from 'ooxml-core/notebook';

const SCALE = 2;
const MAX_SIDE = 8192;

async function toPng(
	canvas: HTMLCanvasElement,
	width: number,
	height: number,
): Promise<ExportPicture | null> {
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
	if (!blob) return null;
	return {
		bytes: new Uint8Array(await blob.arrayBuffer()),
		width: Math.round(width),
		height: Math.round(height),
	};
}

function surface(
	width: number,
	height: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
	const scale = Math.min(SCALE, MAX_SIDE / Math.max(width, height, 1));
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.ceil(width * scale));
	canvas.height = Math.max(1, Math.ceil(height * scale));
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;
	ctx.scale(scale, scale);
	return { canvas, ctx };
}

/** A picture decoded for drawing, with its own size; `close` frees it. */
interface Decoded {
	image: CanvasImageSource;
	width: number;
	height: number;
	close: () => void;
}

async function decode(bytes: Uint8Array, mime: string): Promise<Decoded> {
	const blob = new Blob([bytes.slice()], { type: mime });
	if (mime === 'image/svg+xml') {
		// Chromium's createImageBitmap refuses SVG; an image element decodes it.
		const url = URL.createObjectURL(blob);
		const close = (): void => URL.revokeObjectURL(url);
		try {
			const image = new Image();
			image.src = url;
			await image.decode();
			return { image, width: image.naturalWidth, height: image.naturalHeight, close };
		} catch (error) {
			close();
			throw error;
		}
	}
	const bitmap = await createImageBitmap(blob);
	return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
}

/** A picture's own size in pixels (`PageExportOptions.measure`), or `null` when it cannot be read. */
export async function measurePicture(picture: {
	bytes: Uint8Array;
	mime: string;
}): Promise<{ width: number; height: number } | null> {
	try {
		const { width, height, close } = await decode(picture.bytes, picture.mime);
		close();
		return width > 0 && height > 0 ? { width, height } : null;
	} catch {
		return null;
	}
}

export async function rasterize(request: RasterRequest): Promise<ExportPicture | null> {
	try {
		if (request.kind === 'ink') {
			const { bounds } = request;
			if (bounds.width <= 0 || bounds.height <= 0) return null;
			const target = surface(bounds.width, bounds.height);
			if (!target) return null;
			target.ctx.translate(-bounds.x, -bounds.y);
			for (const stroke of request.strokes) {
				target.ctx.globalAlpha = stroke.tool === 'highlighter' ? 0.4 : 1;
				target.ctx.fillStyle = stroke.color;
				target.ctx.fill(new Path2D(inkOutline(stroke.points, stroke.width, stroke.tool)));
			}
			return toPng(target.canvas, bounds.width, bounds.height);
		}
		const decoded = await decode(request.bytes, request.mime);
		try {
			// In its own shape within its frame, as the page shows it (object-fit: contain).
			const at = containRect(decoded, request);
			const target = surface(at.width, at.height);
			if (!target) return null;
			target.ctx.drawImage(decoded.image, 0, 0, at.width, at.height);
			return toPng(target.canvas, at.width, at.height);
		} finally {
			decoded.close();
		}
	} catch {
		return null;
	}
}

/** Save bytes as a file through a temporary link (the default of every export and download). */
export function downloadBytes(
	bytes: Uint8Array,
	fileName: string,
	mime: string,
	doc: Document = document,
): void {
	const url = URL.createObjectURL(new Blob([bytes.slice()], { type: mime }));
	const link = doc.createElement('a');
	link.href = url;
	link.download = fileName;
	link.rel = 'noopener';
	doc.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
