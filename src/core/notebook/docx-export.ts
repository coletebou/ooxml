// A notebook page as a Word document, through the `docx` area. A free-form page has no flow, so the
// containers are written in reading order (top to bottom, then left to right): text keeps its
// headings, lists, to-do checkboxes (Word checkbox content controls), bold, italic, underline,
// strikethrough, highlight and links; pictures become inline pictures; the page's ink becomes one
// picture (rasterised by the host, which owns a canvas); an embedded file becomes a labelled line.
// Positions on the page are not kept. The report lists everything that was approximated or left
// out. New code.
import {
	createDocument,
	type Block,
	type DocumentModel,
	type PendingMediaPart,
} from '../docx/model';
import type { Paragraph } from '../docx/model-paragraph';
import { containRect } from '../geometry/fit';
import { signedTwips } from '../units/units';
import type { TextRun } from '../docx/model-run';
import { ensureListDefinition } from '../docx/numbering-editing';
import { loadDocx } from '../docx/parse';
import { saveDocx } from '../docx/save';
import type { Rect } from './ink';
import type { InkStroke } from './model';
import { readingOrder } from './reading-order';
import { type RichNode, inlineText } from './rich-text';

export type PageExportItem =
	| { kind: 'text'; x: number; y: number; blocks: readonly RichNode[]; overLimit?: boolean }
	| {
			kind: 'image';
			x: number;
			y: number;
			width: number;
			height: number;
			name: string;
			mime: string;
			alt: string;
			bytes: Uint8Array | null;
	  }
	| { kind: 'file'; x: number; y: number; name: string; size: number }
	| { kind: 'ink'; x: number; y: number; strokes: readonly InkStroke[]; bounds: Rect };

export interface PageExportInput {
	title: string;
	/** A line under the title, such as the page's formatted creation date. */
	subtitle?: string;
	items: readonly PageExportItem[];
}

/** A PNG picture and its display size in CSS px. */
export interface ExportPicture {
	bytes: Uint8Array;
	width: number;
	height: number;
}

export type RasterRequest =
	| { kind: 'ink'; strokes: readonly InkStroke[]; bounds: Rect }
	| { kind: 'image'; bytes: Uint8Array; mime: string; width: number; height: number };

export interface PageExportOptions {
	/**
	 * Draw ink (and pictures Word cannot show, such as WebP) as PNG, a picture in its own shape
	 * within its frame as the page shows it. Without it they are skipped.
	 */
	rasterize?: (request: RasterRequest) => Promise<ExportPicture | null>;
	/**
	 * The size a picture is drawn at by itself (its pixels), so one in a frame of another shape is
	 * written in its own shape within the frame, as the page shows it. Without it (or when it gives
	 * `null`) a picture is written at its frame's size.
	 */
	measure?: (picture: {
		bytes: Uint8Array;
		mime: string;
	}) => Promise<{ width: number; height: number } | null>;
	/** The line written for an embedded file. Default `Attached file: <name>`. */
	fileLabel?: (file: { name: string; size: number }) => string;
	/** Text width in CSS px; wider pictures are scaled down. Default 624 (Letter, 1 inch margins). */
	maxWidth?: number;
}

export interface PageExportReport {
	pictures: number;
	ink: number;
	files: number;
	skipped: {
		kind: 'image' | 'ink' | 'text';
		name?: string;
		reason: 'no-bytes' | 'unsupported-format' | 'no-rasterizer' | 'text-over-limit';
	}[];
}

const WORD_PICTURES: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpeg',
	'image/gif': 'gif',
	'image/bmp': 'bmp',
};

const MARKS: Record<string, (run: TextRun, attrs: Record<string, unknown>) => void> = {
	bold: (run) => (run.bold = true),
	italic: (run) => (run.italic = true),
	underline: (run) => (run.underline = true),
	strike: (run) => (run.strike = true),
	highlight: (run, attrs) => (run.highlight = (attrs.color as TextRun['highlight']) ?? 'yellow'),
	link: (run, attrs) => (run.link = { href: String(attrs.href) }),
};

interface ListContext {
	numId: number;
	level: number;
	kind: 'bullet' | 'decimal';
}

class Writer {
	readonly blocks: Block[] = [];
	readonly media = new Map<string, PendingMediaPart>();
	readonly report: PageExportReport = { pictures: 0, ink: 0, files: 0, skipped: [] };
	private ids = 0;
	private controls = 1000;
	constructor(readonly model: DocumentModel) {}

	paragraph(runs: TextRun[], extra: Partial<Paragraph> = {}): void {
		this.blocks.push({ ...extra, type: 'paragraph', id: `nb${++this.ids}`, runs });
	}

	runs(nodes: readonly RichNode[]): TextRun[] {
		const out: TextRun[] = [];
		for (const node of nodes) {
			if (node.type === 'hard_break') out.push({ text: '\n' });
			if (node.type !== 'text' || !node.text) continue;
			const run: TextRun = { text: node.text };
			for (const mark of node.marks ?? []) MARKS[mark.type]?.(run, mark.attrs ?? {});
			out.push(run);
		}
		return out;
	}

	checkbox(done: boolean): TextRun[] {
		const glyph = {
			checked: { code: '2612', font: 'MS Gothic' },
			unchecked: { code: '2610', font: 'MS Gothic' },
		};
		return [
			{
				text: done ? '☒' : '☐',
				fontFamily: 'MS Gothic',
				contentControl: {
					id: String(++this.controls),
					level: 'inline',
					kind: 'checkbox',
					checked: done,
					checkedGlyph: glyph.checked,
					uncheckedGlyph: glyph.unchecked,
				},
			},
			{ text: ' ' },
		];
	}

	text(blocks: readonly RichNode[], list?: ListContext): void {
		// In a list item only the first paragraph carries the number; the ones after it continue the
		// item, indented to its text, as they read on the page.
		let numbered = false;
		// Only the item's first nested list continues its parent's numbering: Word restarts a level
		// only after an item of the level above, so a second one after a plain paragraph would count on.
		let continued = false;
		for (const node of blocks) {
			if (node.type === 'paragraph' || node.type === 'heading') {
				const todo = node.attrs?.todo;
				const runs = [
					...(todo === 'open' || todo === 'done' ? this.checkbox(todo === 'done') : []),
					...this.runs(node.content ?? []),
				];
				const style =
					node.type === 'heading' ? `Heading${Number(node.attrs?.level ?? 1)}` : undefined;
				const item: Partial<Paragraph> = !list
					? {}
					: numbered
						? { indentLeftTwips: signedTwips(720 * (list.level + 1)) }
						: { numbering: { numId: list.numId, level: list.level } };
				numbered = true;
				this.paragraph(runs, { ...(style ? { style } : {}), ...item });
			} else if (node.type === 'bullet_list' || node.type === 'ordered_list') {
				const kind = node.type === 'bullet_list' ? 'bullet' : 'decimal';
				const level = list ? Math.min(8, list.level + 1) : 0;
				// A numbered list typed as `3. ` starts at 3.
				const order = Number(node.attrs?.order ?? 1);
				const start = kind === 'decimal' && Number.isInteger(order) && order > 1 ? order : 1;
				// A nested list of the same kind continues its parent one level deeper; anything else,
				// or a list with a start of its own, is a Word list of its own, so numbering restarts as
				// it does on the page.
				let numId = list?.kind === kind && start === 1 && !continued ? list.numId : undefined;
				if (numId !== undefined) continued = true;
				if (numId === undefined) {
					const created = ensureListDefinition(this.model.numberingCatalog, kind);
					numId = created.numId;
					// The new instance starts the level its items are written at.
					const instance = created.catalog.nums[String(numId)];
					if (start > 1 && instance)
						instance.levelOverrides = { [level]: { startOverride: start } };
					this.model.numberingCatalog = created.catalog;
				}
				for (const item of node.content ?? [])
					this.text(item.content ?? [], { numId, level, kind });
			}
		}
	}

	picture(picture: ExportPicture, mime: string, name: string, alt: string, maxWidth: number): void {
		const ext = WORD_PICTURES[mime] ?? 'png';
		const scale = picture.width > maxWidth ? maxWidth / picture.width : 1;
		const partName = `word/media/notebook-${this.media.size + 1}.${ext}`;
		const contentType = mime in WORD_PICTURES ? mime : 'image/png';
		this.media.set(partName, { bytes: picture.bytes, contentType });
		this.paragraph([
			{
				text: '',
				image: {
					relId: '',
					partName,
					contentType,
					widthPx: Math.max(1, Math.round(picture.width * scale)),
					heightPx: Math.max(1, Math.round(picture.height * scale)),
					...(alt ? { altText: alt } : {}),
					title: name,
				},
			},
		]);
	}
}

/** Write one page as a .docx package. */
export async function exportPageToDocx(
	input: PageExportInput,
	options: PageExportOptions = {},
): Promise<{ bytes: Uint8Array; report: PageExportReport }> {
	// Lists add numbering definitions, which only a loaded package can write (as the outline does).
	const loaded = await loadDocx(await saveDocx(createDocument()));
	const writer = new Writer(loaded.model);
	const maxWidth = options.maxWidth ?? 624;
	const label = options.fileLabel ?? ((file) => `Attached file: ${file.name}`);
	writer.paragraph([{ text: input.title }], { style: 'Title' });
	if (input.subtitle) writer.paragraph([{ text: input.subtitle }]);
	for (const item of readingOrder(input.items)) {
		if (item.kind === 'text') {
			if (inlineTextOf(item.blocks)) writer.text(item.blocks);
			// Collaborators can merge a box past the text limit; what is past it is not in the file.
			if (item.overLimit) writer.report.skipped.push({ kind: 'text', reason: 'text-over-limit' });
		} else if (item.kind === 'file') {
			writer.paragraph([{ text: label(item) }]);
			writer.report.files++;
		} else if (item.kind === 'image') {
			if (!item.bytes) {
				writer.report.skipped.push({ kind: 'image', name: item.name, reason: 'no-bytes' });
				continue;
			}
			let picture: ExportPicture | null = {
				bytes: item.bytes,
				width: item.width,
				height: item.height,
			};
			let mime = item.mime;
			if (mime in WORD_PICTURES) {
				const natural = await options.measure?.({ bytes: item.bytes, mime }).catch(() => null);
				if (natural) {
					const at = containRect(natural, item);
					picture = { bytes: item.bytes, width: at.width, height: at.height };
				}
			} else {
				picture = options.rasterize
					? await options.rasterize({
							kind: 'image',
							bytes: item.bytes,
							mime,
							width: item.width,
							height: item.height,
						})
					: null;
				mime = 'image/png';
			}
			if (!picture) {
				writer.report.skipped.push({
					kind: 'image',
					name: item.name,
					reason: options.rasterize ? 'unsupported-format' : 'no-rasterizer',
				});
				continue;
			}
			writer.picture(picture, mime, item.name, item.alt, maxWidth);
			writer.report.pictures++;
		} else {
			const picture = options.rasterize
				? await options.rasterize({ kind: 'ink', strokes: item.strokes, bounds: item.bounds })
				: null;
			if (!picture) {
				writer.report.skipped.push({
					kind: 'ink',
					reason: options.rasterize ? 'unsupported-format' : 'no-rasterizer',
				});
				continue;
			}
			writer.picture(picture, 'image/png', 'Ink', '', maxWidth);
			writer.report.ink++;
		}
	}
	loaded.model.blocks = writer.blocks;
	return { bytes: await loaded.save(loaded.model, writer.media), report: writer.report };
}

const inlineTextOf = (blocks: readonly RichNode[]): boolean =>
	blocks.some((b) => b.type !== 'paragraph' || !!inlineText(b.content ?? []) || !!b.attrs?.todo);
