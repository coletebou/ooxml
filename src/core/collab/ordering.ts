// Ordering, de-duplication and conflict-classification helpers for the message envelopes that
// authority-based collaboration (docx-viewer's step batches, presence messages) exchanges. Nothing
// here knows about ProseMirror: a message is `{ clientId, sequence | version, fingerprint }`.
// Extracted from docx-viewer `collaboration.ts` / `collaboration-protocol.ts` / `presence.ts`;
// see PROVENANCE.md.
import { isNonNegativeSafeInteger } from './validation';

export type OrderingStatus = 'apply' | 'duplicate' | 'stale' | 'out-of-order' | 'invalid';

/**
 * Compare a message's base version with the receiver's current version. Authority-ordered streams
 * must be applied strictly in order: older is `stale` (already seen), newer is `out-of-order`
 * (a gap: the receiver must fetch the missing versions first).
 */
export function classifyVersion(
	messageVersion: number,
	currentVersion: number,
): 'apply' | 'stale' | 'out-of-order' | 'invalid' {
	if (!isNonNegativeSafeInteger(messageVersion) || !isNonNegativeSafeInteger(currentVersion))
		return 'invalid';
	if (messageVersion < currentVersion) return 'stale';
	return messageVersion > currentVersion ? 'out-of-order' : 'apply';
}

/** A Map that forgets its oldest entries beyond `limit`, keeping memory bounded in long sessions. */
export class BoundedMap<K, V> {
	private readonly entries = new Map<K, V>();
	constructor(private readonly limit: number) {
		if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('limit must be positive');
	}
	get size(): number {
		return this.entries.size;
	}
	get(key: K): V | undefined {
		return this.entries.get(key);
	}
	has(key: K): boolean {
		return this.entries.has(key);
	}
	set(key: K, value: V): void {
		this.entries.delete(key);
		this.entries.set(key, value);
		if (this.entries.size > this.limit) {
			const oldest = this.entries.keys().next();
			if (!oldest.done) this.entries.delete(oldest.value);
		}
	}
	delete(key: K): boolean {
		return this.entries.delete(key);
	}
	clear(): void {
		this.entries.clear();
	}
}

/**
 * Idempotency cache for request/ack protocols: a retried message with the same id and the same
 * content is a `duplicate` (replay the earlier result), the same id with different content is
 * `reused` (a client bug or an attack), anything else is `fresh`.
 */
export class IdempotencyCache<V = undefined> {
	private readonly seen: BoundedMap<string, { fingerprint: string; value: V }>;
	constructor(limit = 5_000) {
		this.seen = new BoundedMap(limit);
	}
	check(
		clientId: string,
		messageId: string,
		fingerprint: string,
	): { status: 'fresh' } | { status: 'duplicate'; value: V } | { status: 'reused' } {
		const prior = this.seen.get(`${clientId}\u0000${messageId}`);
		if (!prior) return { status: 'fresh' };
		return prior.fingerprint === fingerprint
			? { status: 'duplicate', value: prior.value }
			: { status: 'reused' };
	}
	remember(clientId: string, messageId: string, fingerprint: string, value: V): void {
		this.seen.set(`${clientId}\u0000${messageId}`, { fingerprint, value });
	}
}

/**
 * Per-peer monotonic sequence tracker for transient streams such as presence: a lower sequence is
 * `stale`, an equal one is a `duplicate` of the same content or `invalid` when the content differs
 * (sequence reuse), and a higher one is accepted and remembered.
 */
export class SequenceTracker {
	private readonly last: BoundedMap<string, { sequence: number; fingerprint: string }>;
	constructor(limit = 200) {
		this.last = new BoundedMap(limit);
	}
	/** Classify without recording; call {@link commit} once the message was actually applied. */
	classify(peerId: string, sequence: number, fingerprint: string): OrderingStatus {
		if (!isNonNegativeSafeInteger(sequence) || sequence < 1) return 'invalid';
		const previous = this.last.get(peerId);
		if (!previous || sequence > previous.sequence) return 'apply';
		if (sequence < previous.sequence) return 'stale';
		return previous.fingerprint === fingerprint ? 'duplicate' : 'invalid';
	}
	commit(peerId: string, sequence: number, fingerprint: string): void {
		this.last.set(peerId, { sequence, fingerprint });
	}
	forget(peerId: string): void {
		this.last.delete(peerId);
	}
}

/** Recursively freeze a JSON-like value so a retained envelope cannot be mutated by a transport. */
export function freezeDeep<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) freezeDeep(child);
		Object.freeze(value);
	}
	return value;
}

/**
 * New fractional `order` values that make `current` (orders in the wanted sequence, undefined for
 * new entries) increasing while moving as few entries as possible: the longest increasing run stays.
 * Moved from the xlsx sheet order so every product orders shared lists (sheets, sections, pages)
 * the same way. The keys of the result are indexes into `current`.
 */
export function reorderFractional(current: readonly (number | undefined)[]): Map<number, number> {
	const n = current.length;
	const len = new Array<number>(n).fill(0);
	const prev = new Array<number>(n).fill(-1);
	let best = -1;
	for (let i = 0; i < n; i++) {
		const v = current[i];
		if (v === undefined) continue;
		len[i] = 1;
		for (let j = 0; j < i; j++) {
			const u = current[j];
			if (u !== undefined && u < v && (len[j] ?? 0) + 1 > (len[i] ?? 0)) {
				len[i] = (len[j] ?? 0) + 1;
				prev[i] = j;
			}
		}
		if (best < 0 || (len[i] ?? 0) > (len[best] ?? 0)) best = i;
	}
	const keep = new Set<number>();
	for (let i = best; i >= 0; i = prev[i] ?? -1) keep.add(i);
	const out = new Map<number, number>();
	let low = 0;
	for (let i = 0; i < n; i++) {
		if (keep.has(i)) {
			low = current[i] ?? low;
			continue;
		}
		let high: number | undefined;
		for (let j = i + 1; j < n; j++)
			if (keep.has(j)) {
				high = current[j];
				break;
			}
		const value = high === undefined ? low + 1 : (low + high) / 2;
		if (high !== undefined && !(value > low && value < high)) {
			// Out of precision between neighbours: renumber everything.
			out.clear();
			current.forEach((_v, k) => out.set(k, k + 1));
			return out;
		}
		out.set(i, value);
		low = value;
	}
	return out;
}
