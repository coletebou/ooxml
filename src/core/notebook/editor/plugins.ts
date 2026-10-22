// The editor of one text container, minus its view: y-prosemirror binds the ProseMirror document
// to the container's `Y.XmlFragment` (so collaborators type into the same text and merge per
// character), collaborators' carets come from the notebook session's awareness, and undo goes
// through the notebook's shared undo manager (which therefore also tracks the sync plugin's
// origin). The UI creates the `EditorView` and owns the caret DOM. New code.
import { baseKeymap } from 'prosemirror-commands';
import { inputRules } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { EditorState, Plugin, type Transaction } from 'prosemirror-state';
import type { DecorationAttrs } from 'prosemirror-view';
import {
	initProseMirrorDoc,
	yCursorPlugin,
	yCursorPluginKey,
	ySyncPlugin,
	ySyncPluginKey,
} from 'y-prosemirror';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { MAX_LIST_LEVELS, MAX_TEXT_LENGTH, MAX_TEXT_NODES } from '../model';
import { notebookInputRules } from './input-rules';
import { type KeymapHandlers, notebookKeymap } from './keymap';
import { notebookSchema } from './schema';

export interface NotebookEditorOptions extends KeymapHandlers {
	fragment: Y.XmlFragment;
	undo: Y.UndoManager;
	/** The notebook session's awareness, for collaborators' carets. */
	awareness?: Awareness;
	/** DOM of a collaborator's caret and the attributes of their selection (the UI owns both). */
	cursorBuilder?: (user: unknown, clientId: number) => HTMLElement;
	selectionBuilder?: (user: unknown, clientId: number) => DecorationAttrs;
	/** Plugins of the UI (decorations such as to-do checkboxes), run before the keymaps. */
	plugins?: readonly Plugin[];
}

const LISTS = new Set(['bullet_list', 'ordered_list']);

/** The deepest list nesting in `doc`. */
function listDepth(doc: ProseMirrorNode): number {
	let deepest = 0;
	const walk = (node: ProseMirrorNode, lists: number): void => {
		node.forEach((child) => {
			const inner = lists + (LISTS.has(child.type.name) ? 1 : 0);
			deepest = Math.max(deepest, inner);
			if (child.childCount) walk(child, inner);
		});
	};
	walk(doc, 0);
	return deepest;
}

/** The deepest list nesting in the parts of the document `tr` changed (a paste, a drop). */
function changedListDepth(tr: Transaction): number {
	let deepest = 0;
	tr.mapping.maps.forEach((map, i) => {
		const rest = tr.mapping.slice(i + 1);
		map.forEach((_oldFrom, _oldTo, from, to) => {
			const start = Math.min(rest.map(from, -1), tr.doc.content.size);
			const end = Math.min(rest.map(to, 1), tr.doc.content.size);
			tr.doc.nodesBetween(start, end, (node, pos) => {
				if (!LISTS.has(node.type.name)) return;
				const $pos = tr.doc.resolve(pos);
				let lists = 1;
				for (let d = $pos.depth; d > 0; d--) if (LISTS.has($pos.node(d).type.name)) lists++;
				deepest = Math.max(deepest, lists);
			});
		});
	});
	return deepest;
}

/** The nodes in `doc`: blocks, text runs and leaves. */
function countNodes(doc: ProseMirrorNode): number {
	let n = 0;
	doc.descendants(() => {
		n++;
	});
	return n;
}

/**
 * Local edits stop at the text, the nodes and the list nesting a container holds
 * (`MAX_TEXT_LENGTH`, `MAX_TEXT_NODES`, `MAX_LIST_LEVELS`, which the indent command also keeps),
 * so what is typed or pasted is what its archive and export keep (the editor's nodes are never
 * fewer than the shared text's). Changes from collaborators and undo (through the sync plugin)
 * always apply, or the editor would part from the shared text; shortening is always allowed.
 */
export function textLimitPlugin(
	limit = MAX_TEXT_LENGTH,
	nodeLimit = MAX_TEXT_NODES,
	listLimit = MAX_LIST_LEVELS,
): Plugin {
	return new Plugin({
		filterTransaction(tr) {
			if (!tr.docChanged || tr.getMeta(ySyncPluginKey)) return true;
			// The document's size bounds its text and its nodes from above, so most edits pass
			// without counting.
			const size = tr.doc.content.size;
			if (size > limit) {
				const after = tr.doc.textContent.length;
				if (after > limit && after > tr.before.textContent.length) return false;
			}
			if (size > nodeLimit) {
				const after = countNodes(tr.doc);
				if (after > nodeLimit && after > countNodes(tr.before)) return false;
			}
			// Only an edit that nests lists deeper than any already there is held back.
			const deepest = changedListDepth(tr);
			if (deepest > listLimit && deepest > listDepth(tr.before)) return false;
			return true;
		},
	});
}

/** Plugins for a text container's editor, in priority order (`mapping` from `initProseMirrorDoc`). */
export function notebookEditorPlugins(
	options: NotebookEditorOptions,
	mapping?: ReturnType<typeof initProseMirrorDoc>['mapping'],
): Plugin[] {
	options.undo.addTrackedOrigin(ySyncPluginKey);
	const cursor = options.awareness
		? [
				yCursorPlugin(options.awareness, {
					...(options.cursorBuilder ? { cursorBuilder: options.cursorBuilder } : {}),
					...(options.selectionBuilder ? { selectionBuilder: options.selectionBuilder } : {}),
				}),
			]
		: [];
	return [
		textLimitPlugin(),
		ySyncPlugin(options.fragment, mapping ? { mapping } : {}),
		...cursor,
		...(options.plugins ?? []),
		inputRules({ rules: notebookInputRules }),
		keymap(notebookKeymap(options)),
		keymap(baseKeymap),
	];
}

/** The initial editor state of a container: its current content and the plugins above. */
export function createNotebookEditorState(options: NotebookEditorOptions): EditorState {
	// The sync plugin reuses the mapping built for the initial document, so nothing re-renders.
	const { doc, mapping } = initProseMirrorDoc(options.fragment, notebookSchema);
	return EditorState.create({
		schema: notebookSchema,
		doc,
		plugins: notebookEditorPlugins(options, mapping),
	});
}

/** Redraw collaborators' carets (after their names or colours changed). */
export function refreshRemoteCursors(state: EditorState): Transaction {
	return state.tr.setMeta(yCursorPluginKey, { awarenessUpdated: true });
}
