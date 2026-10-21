// Keyboard shortcuts of a notebook text container, close to what notebook and web editors use:
// Mod-B/I/U, Mod-Shift-X strikethrough, Mod-Alt-H highlight, Mod-Alt-1/2/3 headings and Mod-Alt-0
// normal text, Mod-. or Mod-Shift-8 bullets, Mod-/ or Mod-Shift-7 numbering, Mod-1 or Mod-Shift-9
// to-do tag, Mod-K link, Tab and Shift-Tab list levels, Shift-Enter line break, and undo through
// the notebook's shared undo manager. Returns plain commands; no DOM. New code.
import type { Command } from 'prosemirror-state';
import {
	enter,
	indentListItem,
	insertHardBreak,
	outdentListItem,
	setBlockStyle,
	toggleFormat,
	toggleHighlight,
	toggleList,
	toggleTodo,
} from './commands';

export interface KeymapHandlers {
	onUndo: () => void;
	onRedo: () => void;
	/** Open the host's link dialog; return false to let the key through. */
	onLink?: () => boolean;
}

const run =
	(fn: () => void): Command =>
	(_state, dispatch) => {
		if (dispatch) fn();
		return true;
	};

export function notebookKeymap(handlers: KeymapHandlers): Record<string, Command> {
	const bullets = toggleList('bullet');
	const numbering = toggleList('ordered');
	return {
		'Mod-z': run(handlers.onUndo),
		'Mod-y': run(handlers.onRedo),
		'Mod-Shift-z': run(handlers.onRedo),
		'Mod-b': toggleFormat('bold'),
		'Mod-i': toggleFormat('italic'),
		'Mod-u': toggleFormat('underline'),
		'Mod-Shift-x': toggleFormat('strike'),
		'Mod-Alt-h': toggleHighlight(),
		'Mod-Alt-0': setBlockStyle('paragraph'),
		'Mod-Alt-1': setBlockStyle('heading1'),
		'Mod-Alt-2': setBlockStyle('heading2'),
		'Mod-Alt-3': setBlockStyle('heading3'),
		'Mod-.': bullets,
		'Mod-Shift-8': bullets,
		'Mod-/': numbering,
		'Mod-Shift-7': numbering,
		'Mod-1': toggleTodo,
		'Mod-Shift-9': toggleTodo,
		'Mod-k': (_state, dispatch) =>
			handlers.onLink ? (dispatch ? handlers.onLink() : true) : false,
		Tab: indentListItem,
		'Shift-Tab': outdentListItem,
		'Shift-Enter': insertHardBreak,
		Enter: enter,
	};
}
