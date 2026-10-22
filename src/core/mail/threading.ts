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

/**
 * The newest of `emails` by `messageDate`, the later one on a tie: of a conversation's messages in
 * reading order, its `latest`, the one a reply answers. Reading order is the thread's, depth first,
 * so the last message in it is not always the newest.
 */
export function newestEmail(emails: readonly EmailSummary[]): EmailSummary | undefined {
	let newest: EmailSummary | undefined;
	for (const email of emails)
		if (!newest || messageDate(email) >= messageDate(newest)) newest = email;
	return newest;
}

/** A quoted left part: `"a.b"@example.com`, with backslash escapes inside the quotes. */
const QUOTED_LEFT = /^"((?:[^"\\]|\\.)*)"(@.*)$/s;

/**
 * A Message-ID as RFC 5256 section 3 compares it: without angle brackets or the quoting of its
 * left part (`"a.b"@x` is `a.b@x`), and with its case kept, since the comparison is case-sensitive.
 */
function cleanId(id: string | undefined): string {
	const bare = (id ?? '').trim().replace(/^<|>$/g, '');
	const quoted = QUOTED_LEFT.exec(bare);
	return quoted ? `${quoted[1]!.replace(/\\(.)/gs, '$1')}${quoted[2]!}` : bare;
}

/**
 * The root of `container`'s tree. While links are only added (one References header), a root found
 * once stays an ancestor of each container on the way up to it, so `roots` keeps it for them and
 * the next walk from any of them starts there.
 */
function rootOf(container: Container, roots: Map<Container, Container>): Container {
	const path: Container[] = [];
	let at = container;
	for (let up = roots.get(at) ?? at.parent; up; up = roots.get(at) ?? at.parent) {
		path.push(at);
		at = up;
	}
	for (const below of path) roots.set(below, at);
	return at;
}

/**
 * True when linking `child`, which has no parent, below `parent` would close a loop: when `child`
 * is the root of `parent`'s tree. A container without children is nobody's ancestor, so a fresh one
 * is linked without walking up from `parent`: a long References header stays linear, and with the
 * roots it found (`roots`) one that repeats its ids walks up once, not once per repetition.
 */
function wouldLoop(
	parent: Container,
	child: Container,
	roots = new Map<Container, Container>(),
): boolean {
	return child.children.length ? rootOf(parent, roots) === child : parent === child;
}

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
		const roots = new Map<Container, Container>();
		for (const ref of refs) {
			const container = containerFor(ref);
			if (previous && !container.parent && !wouldLoop(previous, container, roots))
				link(previous, container);
			previous = container;
		}
		// The message's own parent is its last reference, replacing a guessed one (1C). Unlinking it
		// leaves the roots found above wrong for its own tree, so this walk starts afresh.
		if (previous !== own) {
			unlink(own);
			if (previous && !wouldLoop(previous, own)) link(previous, own);
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

/**
 * Step 3: drop empty placeholders, promoting their children (not to the root, unless one). From
 * the top down, each placeholder is opened once and each message moved once: from the bottom up,
 * every placeholder of a long missing chain held its own copy of all the messages below it, as
 * many as the chain is long times the replies at its end (References come from senders).
 */
function prune(roots: Container[]): Container[] {
	const stack = [...roots];
	while (stack.length) {
		const container = stack.pop()!;
		const next: Container[] = [];
		// The children in order, a placeholder's own in its place.
		const pending = [...container.children].reverse();
		while (pending.length) {
			const child = pending.pop()!;
			if (!child.email) {
				for (let i = child.children.length - 1; i >= 0; i--) pending.push(child.children[i]!);
				continue;
			}
			child.parent = container;
			next.push(child);
			stack.push(child);
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
		const messages = entries.map((entry) => entry.email);
		const latest = newestEmail(messages)!;
		let first = messages[0]!;
		for (const email of messages) if (messageDate(email) < messageDate(first)) first = email;
		conversations.push({ id: first.id, entries, latest, date: messageDate(latest) });
	}
	return conversations.sort((a, b) => b.date - a.date || a.id.localeCompare(b.id));
}
