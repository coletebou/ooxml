// The mail keyboard shortcuts, as a pure map from a key event to a command so they can be tested
// and listed in the shortcuts dialog. They follow the conventions of common web mail programs.
// Typing in a field never triggers one (except Escape and the send chord), and a key a focused
// control acts on itself (Enter on a button or a link, the arrows on a tab) stays the control's, so
// Enter opens from the message list only. New code.

export type MailCommand =
	| 'compose'
	| 'search'
	| 'next'
	| 'previous'
	| 'open'
	| 'close'
	| 'select'
	| 'selectAll'
	| 'archive'
	| 'delete'
	| 'junk'
	| 'flag'
	| 'markRead'
	| 'markUnread'
	| 'reply'
	| 'replyAll'
	| 'forward'
	| 'send'
	| 'help';

export interface KeyLike {
	key: string;
	ctrlKey?: boolean;
	metaKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
}

/** Each command with the keys a person presses, in the order the help dialog lists them. */
export const SHORTCUTS: readonly { command: MailCommand; keys: readonly string[] }[] = [
	{ command: 'compose', keys: ['c'] },
	{ command: 'search', keys: ['/'] },
	{ command: 'next', keys: ['j', 'ArrowDown'] },
	{ command: 'previous', keys: ['k', 'ArrowUp'] },
	{ command: 'open', keys: ['o', 'Enter'] },
	{ command: 'close', keys: ['Escape'] },
	{ command: 'select', keys: ['x'] },
	{ command: 'selectAll', keys: ['Ctrl+A'] },
	{ command: 'archive', keys: ['e'] },
	{ command: 'delete', keys: ['#', 'Delete'] },
	{ command: 'junk', keys: ['!'] },
	{ command: 'flag', keys: ['s'] },
	{ command: 'markRead', keys: ['Shift+I'] },
	{ command: 'markUnread', keys: ['Shift+U'] },
	{ command: 'reply', keys: ['r'] },
	{ command: 'replyAll', keys: ['a'] },
	{ command: 'forward', keys: ['f'] },
	{ command: 'send', keys: ['Ctrl+Enter'] },
	{ command: 'help', keys: ['?'] },
];

const PLAIN: Record<string, MailCommand> = {
	c: 'compose',
	'/': 'search',
	j: 'next',
	ArrowDown: 'next',
	k: 'previous',
	ArrowUp: 'previous',
	o: 'open',
	Enter: 'open',
	x: 'select',
	e: 'archive',
	'#': 'delete',
	Delete: 'delete',
	'!': 'junk',
	s: 'flag',
	r: 'reply',
	a: 'replyAll',
	f: 'forward',
	'?': 'help',
};

/**
 * The command for a key press, or null. `typing` is true while the focus is in a text field: only
 * Escape and Ctrl/Cmd+Enter count there.
 */
export function commandFor(event: KeyLike, typing: boolean): MailCommand | null {
	const chord = event.ctrlKey || event.metaKey;
	if (event.key === 'Escape') return 'close';
	if (chord && event.key === 'Enter') return 'send';
	if (typing || event.altKey) return null;
	if (chord) return event.key.toLowerCase() === 'a' ? 'selectAll' : null;
	if (event.shiftKey && (event.key === 'I' || event.key === 'i')) return 'markRead';
	if (event.shiftKey && (event.key === 'U' || event.key === 'u')) return 'markUnread';
	return PLAIN[event.key] ?? null;
}

/**
 * The inputs nobody types text in: a checkbox (a message's selection), a button, a slider. The keys
 * they act on (Space, Enter, the arrows) stay theirs through `controlOwnsKey`.
 */
const NOT_TYPED = new Set([
	'button',
	'checkbox',
	'color',
	'file',
	'hidden',
	'image',
	'radio',
	'range',
	'reset',
	'submit',
]);

/** True when an event comes from a place a person types in. */
export function isTyping(path: readonly EventTarget[]): boolean {
	const target = path[0] as HTMLElement | undefined;
	if (!target || !('tagName' in target)) return false;
	const tag = target.tagName;
	return (
		(tag === 'INPUT' && !NOT_TYPED.has((target as HTMLInputElement).type)) ||
		tag === 'TEXTAREA' ||
		tag === 'SELECT' ||
		target.isContentEditable === true ||
		target.getAttribute?.('contenteditable') === 'true'
	);
}

/** The keys a focused control acts on itself: Enter and Space activate it, the arrows move in it. */
const CONTROL_KEYS = new Set([
	'Enter',
	' ',
	'ArrowUp',
	'ArrowDown',
	'ArrowLeft',
	'ArrowRight',
	'Home',
	'End',
	'PageUp',
	'PageDown',
]);
const CONTROL_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);
/**
 * The ARIA roles of focusable controls. A composite one that keeps the focus itself (a `listbox`
 * with an active descendant, as the message list is) is not here: it handles its keys or leaves
 * them to the app.
 */
const CONTROL_ROLES = new Set([
	'button',
	'checkbox',
	'combobox',
	'gridcell',
	'link',
	'menuitem',
	'menuitemcheckbox',
	'menuitemradio',
	'option',
	'radio',
	'scrollbar',
	'searchbox',
	'slider',
	'spinbutton',
	'switch',
	'tab',
	'textbox',
	'treeitem',
]);

/**
 * True when the focused control acts on this key itself (Enter on a button, a link or a summary,
 * the arrows on a tab or in a field), so the key is not a shortcut. The send chord stays one.
 */
export function controlOwnsKey(event: KeyLike, path: readonly EventTarget[]): boolean {
	if (event.ctrlKey || event.metaKey || !CONTROL_KEYS.has(event.key)) return false;
	const target = path[0] as HTMLElement | undefined;
	if (!target || !('tagName' in target)) return false;
	return (
		CONTROL_TAGS.has(target.tagName) ||
		isTyping(path) ||
		CONTROL_ROLES.has(target.getAttribute?.('role') ?? '')
	);
}
