// The ProseMirror schema of a notebook text container. Marks reuse Word's specs (bold, italic,
// underline, strikethrough, highlight with Word's named colours, links) so text pastes the same way
// and exports one to one; blocks are paragraphs and headings that can carry a to-do tag (`todo`:
// `open` or `done`), and nested bullet and numbered lists. Node and mark names are the contract of
// `../rich-text.ts`, which reads the same content without ProseMirror. DOM-free. New code.
import { type MarkSpec, type NodeSpec, Schema } from 'prosemirror-model';
import { markSpecs } from '../../docx/ui/schema-marks';
import { isOpenableHyperlinkHref } from '../../opc/safe-href';

const todoOf = (el: HTMLElement): string | null => {
	const value = el.getAttribute('data-todo');
	return value === 'open' || value === 'done' ? value : null;
};
const todoDom = (todo: unknown): Record<string, string> =>
	todo === 'open' || todo === 'done' ? { 'data-todo': todo } : {};

const nodes: Record<string, NodeSpec> = {
	doc: { content: 'block+' },
	paragraph: {
		attrs: { todo: { default: null } },
		content: 'inline*',
		group: 'block',
		parseDOM: [{ tag: 'p', getAttrs: (el) => ({ todo: todoOf(el as HTMLElement) }) }],
		toDOM: (node) => ['p', todoDom(node.attrs.todo), 0],
	},
	heading: {
		attrs: { level: { default: 1 }, todo: { default: null } },
		content: 'inline*',
		group: 'block',
		defining: true,
		parseDOM: [1, 2, 3, 4, 5, 6].map((n) => ({
			tag: `h${n}`,
			getAttrs: (el: HTMLElement) => ({ level: Math.min(n, 3), todo: todoOf(el) }),
		})),
		toDOM: (node) => [`h${node.attrs.level}`, todoDom(node.attrs.todo), 0],
	},
	bullet_list: {
		content: 'list_item+',
		group: 'block',
		parseDOM: [{ tag: 'ul' }],
		toDOM: () => ['ul', 0],
	},
	ordered_list: {
		attrs: { order: { default: 1 } },
		content: 'list_item+',
		group: 'block',
		parseDOM: [
			{
				tag: 'ol',
				getAttrs: (el) => {
					const start = Number((el as HTMLElement).getAttribute('start') ?? 1);
					return { order: Number.isInteger(start) && start > 0 ? start : 1 };
				},
			},
		],
		toDOM: (node) => (node.attrs.order === 1 ? ['ol', 0] : ['ol', { start: node.attrs.order }, 0]),
	},
	list_item: {
		content: 'paragraph block*',
		defining: true,
		parseDOM: [{ tag: 'li' }],
		toDOM: () => ['li', 0],
	},
	text: { group: 'inline' },
	hard_break: {
		inline: true,
		group: 'inline',
		selectable: false,
		parseDOM: [{ tag: 'br' }],
		toDOM: () => ['br'],
	},
};

const { bold, italic, underline, strike, highlight, link } = markSpecs;

/** Word's link mark, also reading plain web links when text is pasted from a page. */
const notebookLink: MarkSpec = {
	...link,
	parseDOM: [
		...(link.parseDOM ?? []),
		{
			tag: 'a[href]',
			getAttrs: (el) => {
				const href = (el as HTMLElement).getAttribute('href') ?? '';
				return isOpenableHyperlinkHref(href)
					? { href: href.trim(), anchor: null, tooltip: null }
					: false;
			},
		},
	],
};

export const notebookSchema = new Schema({
	nodes,
	marks: { bold, italic, underline, strike, highlight, link: notebookLink },
});
