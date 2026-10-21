// Rich text of a text container without ProseMirror. The editor binds a `Y.XmlFragment` through
// y-prosemirror, whose encoding is: an element node is a `Y.XmlElement` named after the node type
// with its non-null attributes; a run of text is a `Y.XmlText` whose delta carries one attribute per
// mark (the mark name, or `name--hash` for marks that may overlap) holding the mark's attributes.
// This module reads that encoding as ProseMirror-shaped JSON (re-validated: only the notebook
// schema's nodes, marks and attribute values survive) and writes JSON back, for search, to-do
// tags, export and archives. The names here are the schema's contract (`editor/schema.ts`).
// New code; only the encoding is y-prosemirror's (MIT), no code was copied. See PROVENANCE.md.
import * as Y from 'yjs';
import { isWordHighlightToken } from '../docx/highlight';
import { isOpenableHyperlinkHref } from '../opc/safe-href';
import { MAX_ELEMENT_DEPTH, MAX_TEXT_LENGTH } from './model';

export const RICH_BLOCK_TYPES = ['paragraph', 'heading', 'bullet_list', 'ordered_list'] as const;
export const RICH_MARK_TYPES = ['bold', 'italic', 'underline', 'strike', 'highlight', 'link'];
export type TodoState = 'open' | 'done';

export interface RichMark {
	type: string;
	attrs?: Record<string, unknown>;
}

export interface RichNode {
	type: string;
	attrs?: Record<string, unknown>;
	content?: RichNode[];
	text?: string;
	marks?: RichMark[];
}

const MAX_TEXT = MAX_TEXT_LENGTH;
// A deeper document (only a hostile one, as the editor stops at MAX_LIST_LEVELS) is cut there.
const MAX_DEPTH = MAX_ELEMENT_DEPTH;
/** Nodes one text box's document is written with at most (an archive's, a paste's). */
const MAX_NODES = 100_000;
const LEAVES = new Set(['hard_break']);
const CONTAINERS = new Set(['bullet_list', 'ordered_list', 'list_item']);

const todoOf = (value: unknown): TodoState | null =>
	value === 'open' || value === 'done' ? value : null;

/** Only the attributes a node type has, with valid values (null when unset). */
function nodeAttrs(
	type: string,
	raw: Record<string, unknown>,
): Record<string, unknown> | undefined {
	if (type === 'paragraph') return { todo: todoOf(raw.todo) };
	if (type === 'heading') {
		const level = Number(raw.level);
		return { level: level === 2 || level === 3 ? level : 1, todo: todoOf(raw.todo) };
	}
	if (type === 'ordered_list') {
		const order = Number(raw.order);
		return { order: Number.isInteger(order) && order > 0 && order < 1e6 ? order : 1 };
	}
	return undefined;
}

function markOf(name: string, attrs: unknown): RichMark | undefined {
	const type = name.replace(/--[^-]*$/u, '');
	if (!RICH_MARK_TYPES.includes(type)) return undefined;
	const raw = attrs && typeof attrs === 'object' ? (attrs as Record<string, unknown>) : {};
	if (type === 'highlight') {
		const color =
			typeof raw.color === 'string' && isWordHighlightToken(raw.color) && raw.color !== 'none'
				? raw.color
				: 'yellow';
		return { type, attrs: { color } };
	}
	if (type === 'link') {
		if (typeof raw.href !== 'string' || !isOpenableHyperlinkHref(raw.href)) return undefined;
		return { type, attrs: { href: raw.href.trim(), anchor: null, tooltip: null } };
	}
	return { type };
}

function readText(text: Y.XmlText, budget: { chars: number }): RichNode[] {
	const out: RichNode[] = [];
	for (const op of text.toDelta() as { insert?: unknown; attributes?: Record<string, unknown> }[]) {
		if (typeof op.insert !== 'string' || !op.insert) continue;
		const value = op.insert.slice(0, Math.max(0, budget.chars));
		budget.chars -= value.length;
		if (!value) break;
		const marks = Object.entries(op.attributes ?? {})
			.map(([name, attrs]) => markOf(name, attrs))
			.filter((m): m is RichMark => !!m);
		out.push(marks.length ? { type: 'text', text: value, marks } : { type: 'text', text: value });
	}
	return out;
}

function readNodes(
	items: readonly unknown[],
	depth: number,
	budget: { chars: number },
): RichNode[] {
	const out: RichNode[] = [];
	for (const item of items) {
		if (item instanceof Y.XmlText) {
			out.push(...readText(item, budget));
			continue;
		}
		if (!(item instanceof Y.XmlElement)) continue;
		const type = item.nodeName;
		const children = depth < MAX_DEPTH ? readNodes(item.toArray(), depth + 1, budget) : [];
		const known =
			type === 'paragraph' || type === 'heading' || CONTAINERS.has(type) || LEAVES.has(type);
		if (!known) {
			// An element this schema does not know keeps its text, unwrapped.
			out.push(...children);
			continue;
		}
		const attrs = nodeAttrs(type, item.getAttributes() as Record<string, unknown>);
		const node: RichNode = { type };
		if (attrs) node.attrs = attrs;
		if (!LEAVES.has(type) && children.length) node.content = children;
		out.push(node);
	}
	return out;
}

const KNOWN = new Set(['text', 'paragraph', 'heading', ...CONTAINERS, ...LEAVES]);

/** Nodes this schema does not know are replaced by their content (their text is kept). */
function unwrapUnknown(nodes: readonly RichNode[], depth = 0): RichNode[] {
	if (depth > MAX_DEPTH) return [];
	return nodes.flatMap((node) =>
		node && typeof node === 'object' && KNOWN.has(node.type)
			? [node]
			: unwrapUnknown(Array.isArray(node?.content) ? node.content : [], depth + 1),
	);
}

/** An object with a string `type`: the shape both nodes and marks need before anything else. */
const isTyped = <T extends { type: string }>(value: unknown): value is T =>
	!!value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';
const isNode = (value: unknown): value is RichNode => isTyped<RichNode>(value);

/** A node's children, whatever an archive or a caller put there: only node objects are kept. */
const childrenOf = (node: RichNode): RichNode[] =>
	Array.isArray(node.content) ? node.content.filter(isNode) : [];

/** A text run or a leaf rebuilt from its valid parts only (text a string, marks objects). */
function inlineNode(node: RichNode, budget: { chars: number; nodes: number }): RichNode | null {
	if (LEAVES.has(node.type)) return { type: node.type };
	if (typeof node.text !== 'string' || !node.text) return null;
	const text = node.text.slice(0, Math.max(0, budget.chars));
	budget.chars -= text.length;
	if (!text) return null;
	const marks = Array.isArray(node.marks) ? node.marks.filter((m) => isTyped<RichMark>(m)) : [];
	return marks.length ? { type: 'text', text, marks } : { type: 'text', text };
}

/**
 * Wrap stray inline content into paragraphs and drop empty lists, so blocks are well formed. The
 * input may come from an archive, so any shape is accepted and lists nest at most `MAX_DEPTH` deep.
 */
function normaliseBlocks(
	input: readonly RichNode[],
	depth = 0,
	budget = { chars: MAX_TEXT, nodes: MAX_NODES },
): RichNode[] {
	if (depth > MAX_DEPTH) return [];
	const nodes = unwrapUnknown(input);
	const out: RichNode[] = [];
	let inline: RichNode[] = [];
	const flush = (): void => {
		if (inline.length) out.push({ type: 'paragraph', attrs: { todo: null }, content: inline });
		inline = [];
	};
	for (const node of nodes) {
		// Each node costs one: millions of line breaks or empty paragraphs cost no text, but memory.
		if (--budget.nodes < 0) break;
		if (node.type === 'text' || LEAVES.has(node.type)) {
			const leaf = inlineNode(node, budget);
			if (leaf) inline.push(leaf);
			continue;
		}
		flush();
		if (node.type === 'bullet_list' || node.type === 'ordered_list') {
			const items = childrenOf(node)
				.filter((c) => c.type === 'list_item')
				.map((c) => ({ ...c, content: normaliseBlocks(childrenOf(c), depth + 1, budget) }))
				.map((c) => (c.content.length ? c : { ...c, content: [emptyParagraph()] }));
			if (items.length) out.push({ ...node, content: items });
		} else if (node.type === 'list_item')
			out.push(...normaliseBlocks(childrenOf(node), depth + 1, budget));
		else if (node.type === 'paragraph' || node.type === 'heading') {
			const content = childrenOf(node)
				.filter((c) => c.type === 'text' || LEAVES.has(c.type))
				.filter(() => --budget.nodes >= 0)
				.map((c) => inlineNode(c, budget))
				.filter(isNode);
			out.push(
				content.length ? { ...node, content } : { type: node.type, attrs: node.attrs ?? {} },
			);
		}
	}
	flush();
	return out;
}

const emptyParagraph = (): RichNode => ({ type: 'paragraph', attrs: { todo: null } });

/** The blocks of a text container, re-validated. */
export function readRichText(fragment: Y.XmlFragment): RichNode[] {
	return normaliseBlocks(readNodes(fragment.toArray(), 0, { chars: MAX_TEXT }));
}

function toYText(run: readonly RichNode[]): Y.XmlText {
	const text = new Y.XmlText();
	text.applyDelta(
		run.map((node) => {
			const attributes: Record<string, unknown> = {};
			for (const mark of node.marks ?? []) {
				const valid = markOf(mark.type, mark.attrs);
				if (valid) attributes[valid.type] = valid.attrs ?? {};
			}
			return { insert: node.text ?? '', attributes };
		}),
	);
	return text;
}

function toYNodes(nodes: readonly RichNode[]): (Y.XmlElement | Y.XmlText)[] {
	const out: (Y.XmlElement | Y.XmlText)[] = [];
	let run: RichNode[] = [];
	const flush = (): void => {
		if (run.length) out.push(toYText(run));
		run = [];
	};
	for (const node of nodes) {
		if (node.type === 'text') {
			if (node.text) run.push(node);
			continue;
		}
		flush();
		const element = new Y.XmlElement(node.type);
		for (const [key, value] of Object.entries(nodeAttrs(node.type, node.attrs ?? {}) ?? {}))
			if (value !== null) element.setAttribute(key, value as string);
		const children = toYNodes(node.content ?? []);
		if (children.length) element.insert(0, children);
		out.push(element);
	}
	flush();
	return out;
}

/** Replace the fragment's content with `blocks` (validated and normalised first). */
export function writeRichText(fragment: Y.XmlFragment, blocks: readonly RichNode[]): void {
	const valid = normaliseBlocks(blocks);
	const write = (): void => {
		if (fragment.length) fragment.delete(0, fragment.length);
		fragment.insert(0, toYNodes(valid.length ? valid : [emptyParagraph()]));
	};
	if (fragment.doc) fragment.doc.transact(write);
	else write();
}

/** Plain text as paragraphs (one per line), for pasting text onto a page. */
export function richTextFromPlain(text: string): RichNode[] {
	return text
		.replace(/\r\n?/gu, '\n')
		.slice(0, MAX_TEXT)
		.split('\n')
		.map((line) =>
			line
				? { type: 'paragraph', attrs: { todo: null }, content: [{ type: 'text', text: line }] }
				: emptyParagraph(),
		);
}

export interface TextBlock {
	text: string;
	kind: 'paragraph' | 'heading';
	headingLevel: number;
	todo: TodoState | null;
	/** Nesting depth in lists (0 outside a list) and the innermost list's kind. */
	listDepth: number;
	list: 'bullet' | 'ordered' | null;
}

/** Paragraphs and headings in document order, with their list context. */
export function textBlocks(blocks: readonly RichNode[]): TextBlock[] {
	const out: TextBlock[] = [];
	const walk = (nodes: readonly RichNode[], depth: number, list: TextBlock['list']): void => {
		for (const node of nodes) {
			if (node.type === 'paragraph' || node.type === 'heading') {
				out.push({
					text: inlineText(node.content ?? []),
					kind: node.type,
					headingLevel: node.type === 'heading' ? Number(node.attrs?.level ?? 1) : 0,
					todo: todoOf(node.attrs?.todo),
					listDepth: depth,
					list,
				});
			} else if (node.type === 'bullet_list' || node.type === 'ordered_list') {
				const kind = node.type === 'bullet_list' ? 'bullet' : 'ordered';
				for (const item of node.content ?? []) walk(item.content ?? [], depth + 1, kind);
			}
		}
	};
	walk(blocks, 0, null);
	return out;
}

/** The text of inline content; a line break counts as a newline. */
export function inlineText(nodes: readonly RichNode[]): string {
	return nodes
		.map((n) => (n.type === 'text' ? (n.text ?? '') : n.type === 'hard_break' ? '\n' : ''))
		.join('');
}

/** All the text of a container, one block per line. */
export function plainText(blocks: readonly RichNode[]): string {
	return textBlocks(blocks)
		.map((b) => b.text)
		.join('\n');
}
