// The editor of one text container, minus its view: y-prosemirror binds the ProseMirror document
// to the container's `Y.XmlFragment` (so collaborators type into the same text and merge per
// character), collaborators' carets come from the notebook session's awareness, and undo goes
// through the notebook's shared undo manager (which therefore also tracks the sync plugin's
// origin). The UI creates the `EditorView` and owns the caret DOM. New code.
import { baseKeymap } from 'prosemirror-commands';
import { inputRules } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
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
import { MAX_TEXT_LENGTH } from '../model';
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

/**
 * Local edits stop at the text a container holds (`MAX_TEXT_LENGTH`), so what is typed is what its
 * archive and export keep. Changes from collaborators and undo (through the sync plugin) always
 * apply, or the editor would part from the shared text; shortening is always allowed.
 */
export function textLimitPlugin(limit = MAX_TEXT_LENGTH): Plugin {
	return new Plugin({
		filterTransaction(tr) {
			if (!tr.docChanged || tr.getMeta(ySyncPluginKey)) return true;
			// The document's size bounds its text from above, so most edits pass without counting.
			if (tr.doc.content.size <= limit) return true;
			const after = tr.doc.textContent.length;
			return after <= limit || after <= tr.before.textContent.length;
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
