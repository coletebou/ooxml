// Base-subject extraction (RFC 5256 section 2.1): what is left of a subject once reply and forward
// markers are removed, used to group messages whose references were lost. It moves two indexes over
// the subject rather than cutting a new string at each step, so it takes time linear in the length
// however many markers, blobs or wrappers a sender stacks. New code.

/**
 * Reply and forward markers recognised before a colon. RFC 5256 names `re`, `fwd` and `fw`; the
 * rest are the common translations mail programs write (German `aw`/`wg`, Nordic `sv`/`vs`, Dutch
 * `antw`, French `tr`, Spanish and Portuguese `rv`/`res`/`enc`, Polish `odp`, Turkish `ynt`).
 */
const LEADERS = new Set([
	're',
	'fwd',
	'fw',
	'aw',
	'wg',
	'sv',
	'vs',
	'antw',
	'tr',
	'rv',
	'res',
	'enc',
	'odp',
	'ynt',
]);

export interface BaseSubject {
	/** The base subject, case-folded for comparison; empty when nothing is left. */
	key: string;
	/** The base subject as written (white space collapsed). */
	text: string;
	/** True when a reply or forward marker was removed (RFC 5256 "is a reply or forward"). */
	isReplyOrForward: boolean;
}

/** The word of a reply/forward leader: one to six letters, no more (RFC 5256 `subj-refwd`). */
const WORD = /\p{L}{1,6}(?!\p{L})/uy;
const TRAILER = /\(fwd\)/iy;
const FWD_HEADER = /\[fwd:/iy;

// Every scan below stops at `end`, and white space is down to single spaces by then.
function skipSpaces(text: string, at: number, end: number): number {
	while (at < end && text[at] === ' ') at++;
	return at;
}

function trimEnd(text: string, start: number, end: number): number {
	while (end > start && text[end - 1] === ' ') end--;
	return end;
}

/** Where the `[blob]` opening at `at` closes (RFC 5256 `subj-blob`: no `[` inside), or -1. */
function blobClose(text: string, at: number, end: number): number {
	if (text[at] !== '[') return -1;
	let close = at + 1;
	while (close < end && text[close] !== '[' && text[close] !== ']') close++;
	return close < end && text[close] === ']' ? close : -1;
}

/** The end of the leader at `at` (`re:`, `Re[2]:`, `FWD [list] :`) and the space after it, or -1. */
function leaderEnd(text: string, at: number, end: number): number {
	WORD.lastIndex = at;
	const word = WORD.exec(text)?.[0];
	if (!word || at + word.length > end || !LEADERS.has(word.toLowerCase())) return -1;
	let colon = skipSpaces(text, at + word.length, end);
	const close = blobClose(text, colon, end);
	if (close >= 0) {
		const after = skipSpaces(text, close + 1, end);
		if (after < end && text[after] === ':') colon = after;
	}
	return colon < end && text[colon] === ':' ? skipSpaces(text, colon + 1, end) : -1;
}

/** Steps (3) and (4): where the subject starts once the markers and blobs in front are gone. */
function stripLeaders(
	text: string,
	start: number,
	end: number,
): { start: number; removed: boolean } {
	let removed = false;
	for (;;) {
		let at = start;
		let lastBlob = -1;
		for (let close = blobClose(text, at, end); close >= 0; close = blobClose(text, at, end)) {
			lastBlob = at;
			at = skipSpaces(text, close + 1, end);
		}
		// (3) blobs then a leader go together, as often as they repeat.
		const leader = leaderEnd(text, at, end);
		if (leader >= 0) {
			start = leader;
			removed = true;
			continue;
		}
		// (4) removes leading blobs one at a time while something is left after them, so all of
		// them go but a last one that is the whole remainder.
		if (lastBlob >= 0) start = at < end ? at : lastBlob;
		return { start, removed };
	}
}

/** RFC 5256 base subject of `subject` (already decoded from encoded words). */
export function baseSubject(subject: string): BaseSubject {
	const text = subject.replace(/\s+/g, ' ').trim();
	let start = 0;
	let end = text.length;
	let isReplyOrForward = false;
	for (;;) {
		// (2) trailing "(fwd)" markers.
		for (let at = trimEnd(text, start, end) - 5; at >= start; at = trimEnd(text, start, end) - 5) {
			TRAILER.lastIndex = at;
			if (!TRAILER.test(text)) break;
			end = trimEnd(text, start, at);
			isReplyOrForward = true;
		}
		const leaders = stripLeaders(text, start, end);
		start = leaders.start;
		isReplyOrForward ||= leaders.removed;
		// (5) "[fwd: ... ]" wrapping the whole subject.
		FWD_HEADER.lastIndex = start;
		if (end - start < 6 || text[end - 1] !== ']' || !FWD_HEADER.test(text)) break;
		start = skipSpaces(text, start + 5, end - 1);
		end = trimEnd(text, start, end - 1);
		isReplyOrForward = true;
	}
	const base = text.slice(start, end).trim();
	return { key: base.toLowerCase(), text: base, isReplyOrForward };
}

/**
 * True when a subject (white space down to single spaces) starts `re`, then an optional `[blob]`,
 * then a colon, a space allowed before each. Read with the scans above, not a pattern that tries
 * every way of splitting a run of white space, so any subject takes linear time.
 */
function readsAsReply(text: string): boolean {
	if (text.slice(0, 2).toLowerCase() !== 're') return false;
	let at = skipSpaces(text, 2, text.length);
	const close = blobClose(text, at, text.length);
	if (close >= 0) at = skipSpaces(text, close + 1, text.length);
	return text[at] === ':';
}

/** `Re: <subject>` unless the subject already reads as a reply. */
export function replySubject(subject: string): string {
	const trimmed = subject.trim();
	return readsAsReply(trimmed.replace(/\s+/g, ' ')) ? trimmed : `Re: ${trimmed}`;
}

/** `Fwd: <subject>`. */
export function forwardSubject(subject: string): string {
	return `Fwd: ${subject.trim()}`;
}
