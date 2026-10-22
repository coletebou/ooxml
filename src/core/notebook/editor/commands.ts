// Editing commands of a notebook text container and the formatting the ribbon shows as pressed.
// Lists are prosemirror-schema-list's; a to-do tag is a block attribute that Enter carries to the
// next line (Enter on an empty tagged line removes the tag, as notebook apps do). DOM-free.
// New code.
import { chainCommands, splitBlock, toggleMark } from 'prosemirror-commands';
import type { NodeType } from 'prosemirror-model';
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { isOpenableHyperlinkHref } from '../../opc/safe-href';
import { MAX_LIST_LEVELS } from '../model';
import { notebookSchema as schema } from './schema';

const { nodes, marks } = schema;

export type InlineFormat = 'bold' | 'italic' | 'underline' | 'strike';
export type BlockStyle = 'paragraph' | 'heading1' | 'heading2' | 'heading3';
export type ListKind = 'bullet' | 'ordered';

export const toggleFormat = (format: InlineFormat): Command => toggleMark(marks[format]!);

export function toggleHighlight(color = 'yellow'): Command {
	return (state, dispatch) => {
		const type = marks.highlight!;
		const { from, to, empty, $from } = state.selection;
		const has = empty
			? !!type.isInSet(state.storedMarks ?? $from.marks())
			: state.doc.rangeHasMark(from, to, type);
		if (!dispatch) return true;
		if (empty) {
			dispatch(
				has ? state.tr.removeStoredMark(type) : state.tr.addStoredMark(type.create({ color })),
			);
		} else {
			const tr = state.tr.removeMark(from, to, type);
			dispatch(has ? tr : tr.addMark(from, to, type.create({ color })));
		}
		return true;
	};
}

export function setBlockStyle(style: BlockStyle): Command {
	return (state, dispatch) => {
		const type = style === 'paragraph' ? nodes.paragraph! : nodes.heading!;
		const level = style === 'paragraph' ? undefined : Number(style.slice(-1));
		let applicable = false;
		for (const { $from, $to } of state.selection.ranges)
			state.doc.nodesBetween($from.pos, $to.pos, (node) => {
				if (node.isTextblock && 'todo' in node.attrs) applicable = true;
			});
		if (!applicable) return false;
		if (dispatch) {
			const tr = state.tr;
			// Each block keeps its own to-do tag; only the block type (and level) change.
			for (const { $from, $to } of state.selection.ranges)
				tr.setBlockType($from.pos, $to.pos, type, (node) => ({
					...(level ? { level } : {}),
					todo: node.attrs.todo ?? null,
				}));
			dispatch(tr.scrollIntoView());
		}
		return true;
	};
}

function parentList(state: EditorState): { type: NodeType; pos: number } | null {
	const { $from } = state.selection;
	for (let depth = $from.depth; depth > 0; depth--) {
		const node = $from.node(depth);
		if (node.type === nodes.bullet_list || node.type === nodes.ordered_list)
			return { type: node.type, pos: $from.before(depth) };
	}
	return null;
}

/** Bullets or numbering on, off, or switched to the other kind. */
export function toggleList(kind: ListKind): Command {
	return (state, dispatch, view) => {
		const type = kind === 'bullet' ? nodes.bullet_list! : nodes.ordered_list!;
		const current = parentList(state);
		if (!current) return wrapInList(type)(state, dispatch, view);
		if (current.type === type) return liftListItem(nodes.list_item!)(state, dispatch, view);
		if (dispatch) dispatch(state.tr.setNodeMarkup(current.pos, type));
		return true;
	};
}

/** Indent the list item a level, up to `MAX_LIST_LEVELS` (what the notebook keeps). */
export const indentListItem: Command = (state, dispatch, view) => {
	const { $from } = state.selection;
	let levels = 0;
	for (let depth = $from.depth; depth > 0; depth--) {
		const type = $from.node(depth).type;
		if (type === nodes.bullet_list || type === nodes.ordered_list) levels++;
	}
	if (levels >= MAX_LIST_LEVELS) return false;
	return sinkListItem(nodes.list_item!)(state, dispatch, view);
};
export const outdentListItem: Command = liftListItem(nodes.list_item!);

/** Tag the selected lines as to-dos, or remove the tag when every one already has it. */
export const toggleTodo: Command = (state, dispatch) => {
	const { from, to } = state.selection;
	const blocks: { pos: number; attrs: Record<string, unknown> }[] = [];
	state.doc.nodesBetween(from, to, (node, pos) => {
		if (node.isTextblock && 'todo' in node.attrs) blocks.push({ pos, attrs: node.attrs });
	});
	if (!blocks.length) return false;
	const tagged = blocks.every((b) => b.attrs.todo);
	if (dispatch) {
		const tr = state.tr;
		for (const b of blocks)
			tr.setNodeMarkup(b.pos, undefined, {
				...b.attrs,
				todo: tagged ? null : (b.attrs.todo ?? 'open'),
			});
		dispatch(tr);
	}
	return true;
};

/** Tick or untick the to-do tag of the block at `pos` (a click on its checkbox). */
export function setTodoAt(pos: number, state: 'open' | 'done'): Command {
	return (editor, dispatch) => {
		const node = editor.doc.nodeAt(pos);
		if (!node?.isTextblock || !node.attrs.todo) return false;
		if (dispatch) dispatch(editor.tr.setNodeMarkup(pos, undefined, { ...node.attrs, todo: state }));
		return true;
	};
}

/** Tick or untick the to-do tag of the line with the cursor (the keyboard way to tick a box). */
export const toggleTodoDone: Command = (state, dispatch) => {
	const { $from } = state.selection;
	const todo = $from.parent.attrs.todo;
	if (!todo) return false;
	if (dispatch)
		dispatch(
			state.tr.setNodeMarkup($from.before(), undefined, {
				...$from.parent.attrs,
				todo: todo === 'done' ? 'open' : 'done',
			}),
		);
	return true;
};

function continueTodo(split: Command): Command {
	return (state, dispatch, view) => {
		const { $from, empty } = state.selection;
		if (!empty || !$from.parent.attrs.todo) return false;
		if (!$from.parent.content.size) {
			if (dispatch)
				dispatch(
					state.tr.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, todo: null }),
				);
			return true;
		}
		const tag = (tr: Transaction): Transaction => {
			const $head = tr.selection.$from;
			if ($head.parent.isTextblock && 'todo' in $head.parent.attrs)
				tr.setNodeMarkup($head.before(), undefined, { ...$head.parent.attrs, todo: 'open' });
			return tr;
		};
		return split(state, dispatch && ((tr) => dispatch(tag(tr))), view);
	};
}

export const enter: Command = chainCommands(
	continueTodo(chainCommands(splitListItem(nodes.list_item!), splitBlock)),
	splitListItem(nodes.list_item!),
);

export const insertHardBreak: Command = (state, dispatch) => {
	if (dispatch)
		dispatch(state.tr.replaceSelectionWith(nodes.hard_break!.create()).scrollIntoView());
	return true;
};

/** The extent of the link at `pos` (contiguous text with the same address), if there is one. */
export function linkRangeAt(
	state: EditorState,
	pos: number,
): { from: number; to: number; href: string } | null {
	const type = marks.link!;
	const $pos = state.doc.resolve(pos);
	const runs: { from: number; to: number; href: string | null }[] = [];
	let offset = $pos.start();
	$pos.parent.forEach((child) => {
		const mark = type.isInSet(child.marks);
		runs.push({
			from: offset,
			to: offset + child.nodeSize,
			href: mark ? String(mark.attrs.href ?? '') : null,
		});
		offset += child.nodeSize;
	});
	let at = runs.findIndex((r) => r.href !== null && r.from <= pos && pos < r.to);
	if (at < 0) at = runs.findIndex((r) => r.href !== null && r.from < pos && pos <= r.to);
	const href = runs[at]?.href;
	if (at < 0 || href == null) return null;
	let start = at;
	let end = at;
	while (start > 0 && runs[start - 1]?.href === href) start--;
	while (end < runs.length - 1 && runs[end + 1]?.href === href) end++;
	return { from: runs[start]!.from, to: runs[end]!.to, href };
}

/**
 * Link the selection to `href` (http, https or mailto), or with an empty selection change the
 * link around the cursor, or else insert `text` (default the address) as a link. `null` removes
 * the link from the selection, or the whole link around the cursor.
 */
export function setLink(href: string | null, text?: string): Command {
	return (state, dispatch) => {
		const type = marks.link!;
		const { empty } = state.selection;
		const around = empty ? linkRangeAt(state, state.selection.from) : null;
		const from = around?.from ?? state.selection.from;
		const to = around?.to ?? state.selection.to;
		if (href === null) {
			if (dispatch) dispatch(state.tr.removeMark(from, to, type));
			return true;
		}
		const value = href.trim();
		if (!isOpenableHyperlinkHref(value)) return false;
		if (!dispatch) return true;
		const mark = type.create({ href: value, anchor: null, tooltip: null });
		if (empty && !around) {
			const label = text?.trim() || value;
			dispatch(state.tr.insert(from, schema.text(label, [mark])).scrollIntoView());
			return true;
		}
		// New display text replaces the linked text when it is within one block (across blocks it
		// would join them), keeping the formatting of its first run; unchanged, the runs stay as they are.
		const label = text?.trim() ?? '';
		const $from = state.doc.resolve(from);
		if (
			label &&
			label !== state.doc.textBetween(from, to, ' ') &&
			$from.sameParent(state.doc.resolve(to))
		) {
			const kept = type.removeFromSet(state.doc.nodeAt(from)?.marks ?? []);
			dispatch(state.tr.replaceWith(from, to, schema.text(label, mark.addToSet(kept))));
		} else dispatch(state.tr.removeMark(from, to, type).addMark(from, to, mark));
		return true;
	};
}

export interface ActiveFormats {
	bold: boolean;
	italic: boolean;
	underline: boolean;
	strike: boolean;
	highlight: boolean;
	link: string | null;
	block: BlockStyle;
	list: ListKind | null;
	todo: boolean;
}

/** What the ribbon shows as pressed for the current selection. */
export function activeFormats(state: EditorState): ActiveFormats {
	const { from, to, empty, $from } = state.selection;
	const has = (name: string): boolean => {
		const type = marks[name]!;
		return empty
			? !!type.isInSet(state.storedMarks ?? $from.marks())
			: state.doc.rangeHasMark(from, to, type);
	};
	const parent = $from.parent;
	const linkMark = marks.link!.isInSet($from.marks());
	const list = parentList(state);
	return {
		bold: has('bold'),
		italic: has('italic'),
		underline: has('underline'),
		strike: has('strike'),
		highlight: has('highlight'),
		link: linkMark ? String(linkMark.attrs.href ?? '') : null,
		block:
			parent.type === nodes.heading ? (`heading${parent.attrs.level}` as BlockStyle) : 'paragraph',
		list: list ? (list.type === nodes.bullet_list ? 'bullet' : 'ordered') : null,
		todo: !!parent.attrs.todo,
	};
}
