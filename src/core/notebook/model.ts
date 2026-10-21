// The notebook model: a notebook holds section groups and sections (coloured tabs), a section holds
// pages (subpages by indent level), and every page is a free-form canvas of containers (rich text,
// pictures, embedded files) and ink strokes. Positions and sizes are CSS pixels on the page.
// Everything a peer wrote is re-validated when it is read back, so these sanitisers are the only
// way data leaves the shared document. Pure data, no DOM, no Yjs. New code.
import { stripHtmlTags } from '../collab/validation';
import type { OfficeKind } from '../opc/office-kind';

export const NOTEBOOK_SCHEMA_VERSION = 1;

export const MAX_NAME_CHARS = 120;
export const MAX_TITLE_CHARS = 300;
/** Pages go at most this deep under a top-level page (subpages of subpages). */
export const MAX_PAGE_LEVEL = 2;
/** The canvas extent a container or stroke point may occupy, in CSS px. */
export const MAX_COORDINATE = 100_000;
export const MIN_CONTAINER_WIDTH = 40;
export const MAX_CONTAINER_WIDTH = 4000;
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
/** The most text one container holds: input stops there, and every read and write keeps it. */
export const MAX_TEXT_LENGTH = 200_000;
/** The deepest list nesting a text box holds: indenting stops there, and every read keeps it. */
export const MAX_LIST_LEVELS = 32;
/**
 * Elements deep a text box's document is read: a list level is a list and its item, plus the blocks
 * inside the deepest one. Every reader uses it, so what one finds another finds too.
 */
export const MAX_ELEMENT_DEPTH = MAX_LIST_LEVELS * 2 + 4;

export type SectionKind = 'section' | 'group';

export interface SectionEntry {
	id: string;
	kind: SectionKind;
	name: string;
	/** `#rrggbb` tab colour. */
	color: string;
	/** Enclosing section group, or `''` at the top of the notebook. */
	parentId: string;
	order: number;
	created: number;
	/** When it was moved to the recycle bin (soft delete), if it was. */
	deleted?: number;
}

export type PageLevel = 0 | 1 | 2;

export interface PageEntry {
	id: string;
	sectionId: string;
	title: string;
	created: number;
	order: number;
	/** 0 for a page, 1 and 2 for subpages of the page above it. */
	level: PageLevel;
	deleted?: number;
}

export type ContainerKind = 'text' | 'image' | 'file';

interface ContainerBase {
	id: string;
	pageId: string;
	x: number;
	y: number;
	width: number;
	/** Pictures and files have a height; a text container grows with its content (0). */
	height: number;
	/** Stacking order; higher draws on top. */
	z: number;
}

export interface TextContainer extends ContainerBase {
	kind: 'text';
}

export interface ImageContainer extends ContainerBase {
	kind: 'image';
	name: string;
	mime: string;
	alt: string;
}

export interface FileContainer extends ContainerBase {
	kind: 'file';
	name: string;
	mime: string;
	size: number;
	/** The Office viewer that shows the file live, or `other`. */
	office: OfficeKind;
}

export type Container = TextContainer | ImageContainer | FileContainer;

export type InkTool = 'pen' | 'highlighter';

export interface InkStroke {
	id: string;
	pageId: string;
	tool: InkTool;
	/** `#rrggbb`. */
	color: string;
	/** Nominal width in CSS px at full pressure 0.5. */
	width: number;
	/** Flat `[x, y, pressure, x, y, pressure, ...]`; pressure 0-1. */
	points: readonly number[];
}

/** A notebook as listed on this device (the registry), independent of whether it is open. */
export interface NotebookEntry {
	id: string;
	name: string;
	color: string;
	order: number;
	created: number;
	deleted?: number;
}

export const IMAGE_MIME_TYPES: readonly string[] = [
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp',
	'image/bmp',
	'image/svg+xml',
];

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu;
const ID = /^[\w-]{1,128}$/u;
const HEX = /^#[0-9a-f]{6}$/iu;

export const isEntityId = (value: unknown): value is string =>
	typeof value === 'string' && ID.test(value);

export const isFiniteNumber = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

/** One-line text: markup and control characters removed, whitespace collapsed, capped. */
export function sanitizeLine(value: unknown, max: number): string {
	if (typeof value !== 'string') return '';
	return stripHtmlTags(value).replace(CONTROL, '').replace(/\s+/gu, ' ').trim().slice(0, max);
}

export const sanitizeName = (value: unknown, fallback: string): string =>
	sanitizeLine(value, MAX_NAME_CHARS) || fallback;

export const sanitizeTitle = (value: unknown): string => sanitizeLine(value, MAX_TITLE_CHARS);

export function sanitizeHexColor(value: unknown, fallback: string): string {
	return typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : fallback;
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	if (!isFiniteNumber(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

export const sanitizeTimestamp = (value: unknown): number =>
	isFiniteNumber(value) && value > 0 && value < 8.64e15 ? Math.floor(value) : 0;

export function sanitizeLevel(value: unknown): PageLevel {
	return value === 1 || value === 2 ? value : 0;
}

/** A file name to show and save: path separators and control characters removed. */
export function sanitizeFileName(value: unknown, fallback = 'file'): string {
	const line = sanitizeLine(value, 200).replace(/[\\/:*?"<>|]/gu, '_');
	return line || fallback;
}

export function sanitizeMime(value: unknown, fallback = 'application/octet-stream'): string {
	return typeof value === 'string' && /^[\w.+-]+\/[\w.+-]+$/u.test(value) && value.length <= 120
		? value.toLowerCase()
		: fallback;
}

export const isImageMime = (mime: string): boolean => IMAGE_MIME_TYPES.includes(mime);

/** Order entries for display: by `order`, ties by id so every peer agrees. */
export function byOrder<T extends { order: number; id: string }>(a: T, b: T): number {
	return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
