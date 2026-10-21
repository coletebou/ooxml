// What each keyboard shortcut and toolbar command does in <mail-app>. Actions apply to the selected
// conversations, else the open one, else the one under the list cursor; after a conversation that
// was open is archived, deleted or moved to junk, the next one opens (auto-advance).
import type { MailClient } from 'ooxml-core/mail';
import type { MailCommand } from './keyboard';
import type { MailApp } from './mail-app';

/** The conversations an action applies to. */
function targets(mail: MailClient): string[] {
	const state = mail.getState();
	if (state.selection.length) return [...state.selection];
	const id = state.open?.id ?? state.focusedId;
	return id ? [id] : [];
}

/** The conversation after `id` in the list (or before it at the end), for auto-advance. */
function neighbour(mail: MailClient, ids: readonly string[]): string | null {
	const order = mail.getState().conversations.map((c) => c.id);
	const last = Math.max(...ids.map((id) => order.indexOf(id)));
	const rest = order.filter((id) => !ids.includes(id));
	if (!rest.length) return null;
	const after = order.slice(last + 1).find((id) => !ids.includes(id));
	return after ?? rest.at(-1) ?? null;
}

/** The newest message of the open (else focused) conversation, for reply and forward. */
function latestMessage(mail: MailClient): string | null {
	const state = mail.getState();
	const id = state.open?.id ?? state.focusedId;
	const conversation = state.conversations.find((c) => c.id === id);
	if (state.open?.id === id && state.open.messages.length)
		return state.open.messages.at(-1)!.summary.id;
	return conversation?.emailIds.at(-1) ?? null;
}

async function moveAway(mail: MailClient, run: (ids: string[]) => Promise<void>): Promise<void> {
	const ids = targets(mail);
	if (!ids.length) return;
	const wasOpen = mail.getState().open?.id;
	const next = wasOpen && ids.includes(wasOpen) ? neighbour(mail, ids) : null;
	await run(ids);
	if (next) await mail.open(next);
}

/** The commands that act on conversations, so only while the mail view shows. */
const ON_CONVERSATIONS: ReadonlySet<MailCommand> = new Set<MailCommand>([
	'next',
	'previous',
	'open',
	'select',
	'selectAll',
	'archive',
	'delete',
	'junk',
	'flag',
	'markRead',
	'markUnread',
	'reply',
	'replyAll',
	'forward',
]);

/** Run `command`; returns false when it does not apply (so the key keeps its default). */
export function runCommand(app: MailApp, mail: MailClient, command: MailCommand): boolean {
	// In the calendar and contacts views these keys belong to that view, not to the mail selection.
	if (app.view !== 'mail' && ON_CONVERSATIONS.has(command)) return false;
	const state = mail.getState();
	switch (command) {
		case 'compose':
			void mail.compose('new');
			return true;
		case 'search':
			return app.focusSearch();
		case 'next':
		case 'previous': {
			const id = mail.focusNext(command === 'next' ? 1 : -1);
			if (id && state.open) void mail.open(id);
			return true;
		}
		case 'open':
			if (!state.focusedId) return false;
			void mail.open(state.focusedId);
			return true;
		case 'close':
			return app.closeTopmost();
		case 'select':
			if (!state.focusedId) return false;
			mail.toggleSelected(state.focusedId);
			return true;
		case 'selectAll':
			mail.selectAll();
			return true;
		case 'archive':
			void moveAway(mail, (ids) => mail.archive(ids));
			return true;
		case 'delete':
			void moveAway(mail, (ids) => mail.remove(ids));
			return true;
		case 'junk':
			void moveAway(mail, (ids) => mail.markJunk(ids));
			return true;
		case 'flag':
			void mail.toggleFlagged(targets(mail));
			return true;
		case 'markRead':
		case 'markUnread':
			void mail.markRead(command === 'markRead', targets(mail));
			return true;
		case 'reply':
		case 'replyAll':
		case 'forward': {
			const emailId = latestMessage(mail);
			if (!emailId) return false;
			void mail.compose(command, emailId);
			return true;
		}
		case 'send':
			if (!state.compose) return false;
			void mail.send();
			return true;
		case 'help':
			app.dialog = 'shortcuts';
			return true;
	}
}
