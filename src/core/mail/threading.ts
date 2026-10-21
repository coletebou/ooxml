// Conversation threading, the REFERENCES algorithm of RFC 5256 section 4 (after Jamie Zawinski's):
// messages are linked by `Message-ID`, `References` and `In-Reply-To`, empty placeholders are
// pruned, and threads whose links were lost are grouped by base subject. Every walk is iterative,
// so a reply chain thousands of messages deep cannot overflow the stack. New code.
import type { EmailSummary } from './model';
import { baseSubject } from './subject';

/** One message of a conversation, with how deep it sits in the reply tree (0 for a root). */
export interface ConversationEntry {
	email: EmailSummary;
	depth: number;
}

export interface Conversation {
	/** Stable while the conversation lives: the id of its earliest message. */
	id: string;
	/** Depth first, siblings oldest first: the order a conversation reads in. */
	entries: readonly ConversationEntry[];
	/** The newest message, which a message list shows. */
	latest: EmailSummary;
	/** Time of the newest message (sent date, else received). */
	date: number;
}

interface Container {
	email: EmailSummary | null;
	parent: Container | null;
	children: Container[];
	dropped?: boolean;
}

/** When a message was written: its `Date` header, else when the server received it. */
export const messageDate = (email: EmailSummary): number => email.sentAt ?? email.receivedAt;

const cleanId = (id: string | undefined): string =>
	(id ?? '').trim().replace(/^<|>$/g, '').toLowerCase();

const isAncestor = (ancestor: Container, node: Container | null): boolean => {
	for (let at = node; at; at = at.parent) if (at === ancestor) return true;
	return false;
};

const unlink = (child: Container): void => {
	const parent = child.parent;
	if (!parent) return;
	const index = parent.children.indexOf(child);
	if (index >= 0) parent.children.splice(index, 1);
	child.parent = null;
};

const link = (parent: Container, child: Container): void => {
	child.parent = parent;
	parent.children.push(child);
};

/** The earliest date in a container: its message, else its first child's (children sorted). */
function containerDate(container: Container): number {
	for (let at: Container | undefined = container; at; at = at.children[0])
		if (at.email) return messageDate(at.email);
	return 0;
}

const byDate = (a: Container, b: Container): number => containerDate(a) - containerDate(b);

/** Steps 1 and 2: containers by message id, linked by references; returns the root set. */
function linkMessages(emails: readonly EmailSummary[]): Container[] {
	const byId = new Map<string, Container>();
	const all: Container[] = [];
	const containerFor = (key: string): Container => {
		let container = byId.get(key);
		if (!container) {
			container = { email: null, parent: null, children: [] };
			byId.set(key, container);
			all.push(container);
		}
		return container;
	};
	for (const email of emails) {
		const id = cleanId(email.messageId[0]);
		let own = id ? containerFor(id) : undefined;
		// A message without an id, or a second message reusing one, threads on its own key.
		if (!own || own.email) own = containerFor(`\0${email.id}`);
		own.email = email;
		const refs = (email.references.length ? email.references : email.inReplyTo.slice(0, 1))
			.map(cleanId)
			.filter(Boolean);
		let previous: Container | undefined;
		for (const ref of refs) {
			const container = containerFor(ref);
			if (
				previous &&
				container !== previous &&
				!container.parent &&
				!isAncestor(container, previous)
			)
				link(previous, container);
			previous = container;
		}
		// The message's own parent is its last reference, replacing a guessed one (1C).
		if (previous !== own) {
			unlink(own);
			if (previous && !isAncestor(own, previous)) link(previous, own);
		}
	}
	return all.filter((container) => !container.parent);
}

/** Every container below `roots`, parents before children (iterative pre-order). */
function preOrder(roots: readonly Container[]): Container[] {
	const out: Container[] = [];
	const stack = [...roots].reverse();
	while (stack.length) {
		const container = stack.pop()!;
		out.push(container);
		for (let i = container.children.length - 1; i >= 0; i--) stack.push(container.children[i]!);
	}
	return out;
}

/**
 * Every container's children oldest first. The deepest go first: a placeholder's date is its first
 * child's, so that child's own children must already be in order.
 */
function sortChildren(roots: readonly Container[]): void {
	for (const container of preOrder(roots).reverse()) container.children.sort(byDate);
}

/** Step 3: drop empty placeholders, promoting their children (not to the root, unless one). */
function prune(roots: Container[]): Container[] {
	const order = preOrder(roots);
	for (let i = order.length - 1; i >= 0; i--) {
		const container = order[i]!;
		const next: Container[] = [];
		for (const child of container.children) {
			if (child.email) next.push(child);
			else
				for (const grandchild of child.children) {
					grandchild.parent = container;
					next.push(grandchild);
				}
		}
		container.children = next;
	}
	const kept: Container[] = [];
	for (const root of roots) {
		if (root.email || root.children.length > 1) kept.push(root);
		else if (root.children.length === 1) {
			const only = root.children[0]!;
			only.parent = null;
			kept.push(only);
		}
	}
	return kept;
}

const subjectOf = (container: Container): string =>
	(container.email ?? container.children[0]?.email)?.subject ?? '';

/** Step 5: gather roots that share a base subject. */
function groupBySubject(roots: Container[]): Container[] {
	const info = new Map(roots.map((root) => [root, baseSubject(subjectOf(root))]));
	const table = new Map<string, Container>();
	for (const root of roots) {
		const subject = info.get(root)!;
		if (!subject.key) continue;
		const held = table.get(subject.key);
		const prefer =
			!held ||
			(!root.email && held.email) ||
			(held.email && root.email && info.get(held)!.isReplyOrForward && !subject.isReplyOrForward);
		if (prefer) table.set(subject.key, root);
	}
	const out = [...roots];
	for (const root of roots) {
		const subject = info.get(root)!;
		const target = subject.key ? table.get(subject.key) : undefined;
		// A root already merged under a placeholder (it was the target once) stays where it is.
		if (!target || target === root || root.dropped || root.parent) continue;
		if (!target.email && !root.email) {
			for (const child of root.children) link(target, child);
			root.children = [];
			root.dropped = true;
		} else if (!target.email || (!info.get(target)!.isReplyOrForward && subject.isReplyOrForward)) {
			link(target, root);
		} else {
			// Both replies, or neither: siblings under a new placeholder rather than a guess.
			const holder: Container = { email: null, parent: null, children: [] };
			link(holder, target);
			link(holder, root);
			info.set(holder, info.get(target)!);
			table.set(subject.key, holder);
			out.push(holder);
		}
	}
	return out.filter((root) => !root.parent && !root.dropped);
}

/**
 * Threads `emails` into conversations, newest conversation first. With `byReferences: false` (the
 * flat list) every message is a conversation of its own.
 */
export function threadConversations(
	emails: readonly EmailSummary[],
	options: { byReferences?: boolean; bySubject?: boolean } = {},
): Conversation[] {
	if (options.byReferences === false) {
		return emails
			.map((email) => ({
				id: email.id,
				entries: [{ email, depth: 0 }],
				latest: email,
				date: messageDate(email),
			}))
			.sort((a, b) => b.date - a.date || a.id.localeCompare(b.id));
	}
	let roots = prune(linkMessages(emails));
	sortChildren(roots);
	if (options.bySubject !== false) {
		roots.sort(byDate);
		roots = groupBySubject(roots);
		sortChildren(roots);
	}
	const conversations: Conversation[] = [];
	for (const root of roots) {
		const entries: ConversationEntry[] = [];
		const stack: [Container, number][] = [[root, 0]];
		while (stack.length) {
			const [container, depth] = stack.pop()!;
			const childDepth = container.email ? depth + 1 : depth;
			if (container.email) entries.push({ email: container.email, depth });
			for (let i = container.children.length - 1; i >= 0; i--)
				stack.push([container.children[i]!, childDepth]);
		}
		if (!entries.length) continue;
		let latest = entries[0]!.email;
		let first = entries[0]!.email;
		for (const { email } of entries) {
			if (messageDate(email) >= messageDate(latest)) latest = email;
			if (messageDate(email) < messageDate(first)) first = email;
		}
		conversations.push({ id: first.id, entries, latest, date: messageDate(latest) });
	}
	return conversations.sort((a, b) => b.date - a.date || a.id.localeCompare(b.id));
}
