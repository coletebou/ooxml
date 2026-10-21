// The mail keyboard shortcuts, as a pure map from a key event to a command so they can be tested
// and listed in the shortcuts dialog. They follow the conventions of common web mail programs.
// Typing in a field never triggers one (except Escape and the send chord). New code.

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

/** True when an event comes from a place a person types in. */
export function isTyping(path: readonly EventTarget[]): boolean {
	const target = path[0] as HTMLElement | undefined;
	if (!target || !('tagName' in target)) return false;
	const tag = target.tagName;
	return (
		tag === 'INPUT' ||
		tag === 'TEXTAREA' ||
		tag === 'SELECT' ||
		target.isContentEditable === true ||
		target.getAttribute?.('contenteditable') === 'true'
	);
}
