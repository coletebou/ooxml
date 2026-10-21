// State tracking for `watch` (RFC 8620 5.1, 5.2): the known Mailbox and Email states, the
// `/changes` calls that move them forward and the `MailChange`s they produce. A state is taken from
// the first `/get` that shows one and then only from `/changes`, so no change between two states
// is skipped; a `/get` with a newer state, a push or a poll asks for what happened in between.
// New code.
import type { MailChange } from '../transport';
import type { JmapClient } from './client';
import { strings } from './convert';
import type { JmapCall, JmapResult } from './request';

export type TrackedType = 'Mailbox' | 'Email';
export const TRACKED: readonly TrackedType[] = ['Mailbox', 'Email'];

/** `/changes` pages followed (while `hasMoreChanges`) before giving up with a reset. */
export const MAX_CHANGE_PAGES = 16;

export interface ChangeTracker {
	/** A state seen in a `/get` response. */
	observe(type: TrackedType, state: unknown): void;
	/** The known state, or `null` before the first. */
	state(type: TrackedType): string | null;
	/** Fetches what changed since the known states, when someone is watching. */
	sync(types?: Iterable<TrackedType>): Promise<void>;
	/** Someone is watching: changes are fetched and emitted. */
	setActive(active: boolean): void;
}

interface Collected {
	mailboxes: boolean;
	created: Set<string>;
	updated: Set<string>;
	destroyed: Set<string>;
	reset: Set<TrackedType>;
}

function collect(into: Collected, type: TrackedType, args: Record<string, unknown>): void {
	const created = strings(args.created);
	const updated = strings(args.updated);
	const destroyed = strings(args.destroyed);
	if (type === 'Mailbox') {
		into.mailboxes ||= created.length + updated.length + destroyed.length > 0;
		return;
	}
	for (const id of created) into.created.add(id);
	for (const id of updated) if (!into.created.has(id)) into.updated.add(id);
	for (const id of destroyed) {
		// Reported even when it was created in the same window: the client may have shown it.
		into.created.delete(id);
		into.updated.delete(id);
		into.destroyed.add(id);
	}
}

export function createChangeTracker(
	client: JmapClient,
	emit: (change: MailChange) => void,
	onMailboxesChanged: () => void,
): ChangeTracker {
	const states = new Map<TrackedType, string>();
	const pending = new Set<TrackedType>();
	let active = false;
	let running: Promise<void> | null = null;

	/** `type/get` with no ids: the current state, cheaply. */
	const baseline = async (types: readonly TrackedType[]): Promise<void> => {
		if (!types.length) return;
		const { result, calls } = await client.request((builder, accountId) =>
			types.map((type) => [type, builder.call(`${type}/get`, { accountId, ids: [] })] as const),
		);
		for (const [type, call] of calls) {
			const state = result.get(call).state;
			if (typeof state === 'string') states.set(type, state);
		}
	};

	const readPage = (
		result: JmapResult,
		calls: readonly (readonly [TrackedType, JmapCall])[],
		into: Collected,
		reached: Map<TrackedType, string>,
	): Map<TrackedType, string> => {
		const more = new Map<TrackedType, string>();
		for (const [type, call] of calls) {
			if (result.error(call)?.type === 'cannotCalculateChanges') {
				into.reset.add(type);
				continue;
			}
			const args = result.get(call);
			const next = typeof args.newState === 'string' ? args.newState : '';
			if (!next) {
				into.reset.add(type);
				continue;
			}
			collect(into, type, args);
			reached.set(type, next);
			if (args.hasMoreChanges === true) more.set(type, next);
		}
		return more;
	};

	const syncOnce = async (types: ReadonlySet<TrackedType>): Promise<void> => {
		const into: Collected = {
			mailboxes: false,
			created: new Set(),
			updated: new Set(),
			destroyed: new Set(),
			reset: new Set(),
		};
		const reached = new Map<TrackedType, string>();
		let todo = new Map<TrackedType, string>();
		for (const type of types) {
			const known = states.get(type);
			if (known) todo.set(type, known);
		}
		try {
			await baseline([...types].filter((type) => !states.has(type)));
			for (let page = 0; todo.size; page++) {
				if (page === MAX_CHANGE_PAGES) {
					for (const type of todo.keys()) into.reset.add(type);
					break;
				}
				const since = todo;
				const { result, calls } = await client.request((builder, accountId) =>
					[...since].map(
						([type, state]) =>
							[type, builder.call(`${type}/changes`, { accountId, sinceState: state })] as const,
					),
				);
				todo = readPage(result, calls, into, reached);
			}
			// Take the current state before anyone reloads, so nothing after it is missed.
			await baseline([...into.reset]);
		} finally {
			for (const [type, state] of reached) if (!into.reset.has(type)) states.set(type, state);
			if (into.mailboxes || into.reset.has('Mailbox')) {
				onMailboxesChanged();
				emit({ type: 'mailboxes' });
			}
			if (into.reset.has('Email')) emit({ type: 'reset' });
			else if (into.created.size || into.updated.size || into.destroyed.size)
				emit({
					type: 'emails',
					created: [...into.created],
					updated: [...into.updated],
					destroyed: [...into.destroyed],
				});
		}
	};

	const drain = async (): Promise<void> => {
		while (pending.size) {
			// `setActive(false)` may have run while the last sync was in flight.
			if (!active) return;
			const types = new Set(pending);
			pending.clear();
			try {
				await syncOnce(types);
			} catch {
				// The next push, poll or response with a newer state tries again.
			}
		}
	};

	const kick = (): Promise<void> => {
		running ??= drain().finally(() => {
			running = null;
			if (pending.size && active) void kick();
		});
		return running;
	};

	return {
		observe(type, state) {
			if (typeof state !== 'string' || !state) return;
			const known = states.get(type);
			if (known === undefined) states.set(type, state);
			else if (known !== state && active) {
				pending.add(type);
				void kick();
			}
		},
		state: (type) => states.get(type) ?? null,
		sync(types = TRACKED) {
			if (!active) return Promise.resolve();
			for (const type of types) pending.add(type);
			return kick();
		},
		setActive(next) {
			active = next;
			if (!next) pending.clear();
		},
	};
}
