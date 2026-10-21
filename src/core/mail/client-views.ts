// Pure projections from what the client holds to what the UI shows: the folder tree, the message
// list rows and the open conversation. No I/O, so each is tested on its own. New code.
import type {
	ConversationView,
	MailboxView,
	OpenConversationView,
	OpenMessageView,
} from './client-types';
import {
	DRAFT,
	FLAGGED,
	MAILBOX_ROLES,
	SEEN,
	sameAddress,
	type EmailSummary,
	type MailAddress,
	type Mailbox,
	type MailMessage,
} from './model';
import type { MailErrorCode } from './transport';
import type { Conversation } from './threading';

const roleRank = (mailbox: Mailbox): number =>
	mailbox.role ? MAILBOX_ROLES.indexOf(mailbox.role) : MAILBOX_ROLES.length;

/**
 * Folders in pane order: special-use folders in their usual order, then the person's own by sort
 * order and name, each followed by its children. A folder whose parent is missing is a root.
 */
export function mailboxViews(mailboxes: readonly Mailbox[], locale?: string): MailboxView[] {
	const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
	const ids = new Set(mailboxes.map((mailbox) => mailbox.id));
	const children = new Map<string | null, Mailbox[]>();
	for (const mailbox of mailboxes) {
		const parent = mailbox.parentId && ids.has(mailbox.parentId) ? mailbox.parentId : null;
		children.set(parent, [...(children.get(parent) ?? []), mailbox]);
	}
	const order = (a: Mailbox, b: Mailbox): number =>
		roleRank(a) - roleRank(b) || a.sortOrder - b.sortOrder || collator.compare(a.name, b.name);
	const out: MailboxView[] = [];
	const seen = new Set<string>();
	const stack: [Mailbox, number][] = [...(children.get(null) ?? [])]
		.sort(order)
		.reverse()
		.map((mailbox) => [mailbox, 0]);
	while (stack.length) {
		const [mailbox, depth] = stack.pop()!;
		if (seen.has(mailbox.id)) continue;
		seen.add(mailbox.id);
		out.push({ ...mailbox, depth });
		const kids = [...(children.get(mailbox.id) ?? [])].sort(order).reverse();
		for (const kid of kids) stack.push([kid, depth + 1]);
	}
	return out;
}

const participantsOf = (emails: readonly EmailSummary[]): MailAddress[] => {
	const out: MailAddress[] = [];
	for (const email of emails)
		for (const address of email.from)
			if (!out.some((other) => sameAddress(other, address))) out.push(address);
	return out;
};

/** A message-list row for a conversation. */
export function conversationView(conversation: Conversation): ConversationView {
	const emails = conversation.entries.map((entry) => entry.email);
	const chronological = [...emails].sort(
		(a, b) => (a.sentAt ?? a.receivedAt) - (b.sentAt ?? b.receivedAt),
	);
	return {
		id: conversation.id,
		emailIds: emails.map((email) => email.id),
		subject: chronological[0]?.subject ?? '',
		participants: participantsOf(chronological),
		recipients: [...conversation.latest.to, ...conversation.latest.cc],
		preview: conversation.latest.preview,
		date: conversation.date,
		count: emails.length,
		unread: emails.filter((email) => !email.keywords[SEEN]).length,
		flagged: emails.some((email) => email.keywords[FLAGGED]),
		hasAttachment: emails.some((email) => email.hasAttachment),
		draft: emails.some((email) => email.keywords[DRAFT]),
	};
}

/** The reading pane's view of a conversation, with whatever bodies have loaded. */
export function openConversationView(
	conversation: Conversation,
	loaded: ReadonlyMap<string, MailMessage>,
	errors: ReadonlyMap<string, MailErrorCode>,
): OpenConversationView {
	const messages: OpenMessageView[] = conversation.entries.map((entry) => {
		const message = loaded.get(entry.email.id);
		// The summary stays current (keywords change); the body is what was loaded.
		return {
			summary: entry.email,
			depth: entry.depth,
			message: message
				? { ...message, keywords: entry.email.keywords, mailboxIds: entry.email.mailboxIds }
				: null,
			error: errors.get(entry.email.id) ?? null,
		};
	});
	return { id: conversation.id, subject: conversationView(conversation).subject, messages };
}

/** Ids from `from` to `to` inclusive, in list order (shift-click), or just `to` when one is absent. */
export function rangeBetween(order: readonly string[], from: string | null, to: string): string[] {
	const end = order.indexOf(to);
	const start = from === null ? -1 : order.indexOf(from);
	if (end < 0) return [];
	if (start < 0) return [to];
	const [low, high] = start <= end ? [start, end] : [end, start];
	return order.slice(low, high + 1);
}
