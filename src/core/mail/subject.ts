// Base-subject extraction (RFC 5256 section 2.1): what is left of a subject once reply and forward
// markers are removed, used to group messages whose references were lost. New code.

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

/** `[blob]` with any white space after it, as RFC 5256 `subj-blob`. */
const BLOB = /^\[[^[\]]*\]\s*/;
/** One reply/forward leader: `re`, `Re[2]`, `FWD [list]` followed by `:` (RFC 5256 `subj-refwd`). */
const REFWD = /^([\p{L}]{1,6})\s*(?:\[[^[\]]*\])?\s*:\s*/u;
const TRAILER = /\s*\(fwd\)\s*$/i;

function stripLeaders(subject: string): { rest: string; removed: boolean } {
	let rest = subject;
	let removed = false;
	for (;;) {
		const before = rest;
		// (3) leading blobs then a reply/forward marker, repeated.
		for (;;) {
			let probe = rest;
			while (BLOB.test(probe)) probe = probe.replace(BLOB, '');
			const match = REFWD.exec(probe);
			if (!match || !LEADERS.has(match[1]!.toLowerCase())) break;
			rest = probe.slice(match[0].length);
			removed = true;
		}
		// (4) a leading blob, when something is left after it.
		const blob = BLOB.exec(rest);
		if (blob && rest.slice(blob[0].length).trim()) rest = rest.slice(blob[0].length);
		if (rest === before) return { rest, removed };
	}
}

/** RFC 5256 base subject of `subject` (already decoded from encoded words). */
export function baseSubject(subject: string): BaseSubject {
	let text = subject.replace(/\s+/g, ' ').trim();
	let isReplyOrForward = false;
	for (;;) {
		// (2) trailing "(fwd)" markers.
		while (TRAILER.test(text)) {
			text = text.replace(TRAILER, '');
			isReplyOrForward = true;
		}
		const leaders = stripLeaders(text);
		text = leaders.rest;
		isReplyOrForward ||= leaders.removed;
		// (5) "[fwd: ... ]" wrapping the whole subject.
		const wrapped = /^\[fwd:\s*([\s\S]*)\]$/i.exec(text);
		if (!wrapped) break;
		text = wrapped[1]!.trim();
		isReplyOrForward = true;
	}
	text = text.trim();
	return { key: text.toLowerCase(), text, isReplyOrForward };
}

/** `Re: <subject>` unless the subject already reads as a reply. */
export function replySubject(subject: string): string {
	const trimmed = subject.trim();
	return /^re\s*(?:\[[^[\]]*\])?\s*:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

/** `Fwd: <subject>`. */
export function forwardSubject(subject: string): string {
	return `Fwd: ${subject.trim()}`;
}
