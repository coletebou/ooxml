// The rasteriser the page export hands the core (`PageExportOptions.rasterize`): ink becomes a PNG
// drawn from the same outlines the page shows, and pictures Word cannot show (WebP, SVG) are
// re-encoded as PNG. Drawn at twice the CSS size so they stay sharp when printed.
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
		const bitmap = await createImageBitmap(
			new Blob([request.bytes.slice()], { type: request.mime }),
		);
		const target = surface(request.width, request.height);
		if (!target) return null;
		target.ctx.drawImage(bitmap, 0, 0, request.width, request.height);
		bitmap.close();
		return toPng(target.canvas, request.width, request.height);
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
