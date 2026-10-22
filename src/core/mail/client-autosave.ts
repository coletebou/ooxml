// The compose window's draft saving: a quiet moment after the last edit, never two saves at once,
// again when asked to meanwhile. Only edits the server has saved count as saved, and nothing is
// saved while the window's message is on its way. The window's actions are in
// `client-compose.ts`. New code.
import { errorCode, type ClientCore } from './client-core';
import type { ComposeState } from './client-types';
import { isEmptyDraft } from './compose';
import type { Draft } from './model';
import type { MailErrorCode } from './transport';

const DEFAULT_SAVE_MS = 2000;

/** Changes the open compose window, if one is open. */
export function patchCompose(core: ClientCore, next: Partial<ComposeState>): void {
	const current = core.state.compose;
	if (current) core.patch({ compose: { ...current, ...next } });
}

/** The saving of the open compose window's draft. */
export interface Autosave {
	/**
	 * The open draft has edits the server does not hold yet. A draft never saved is not saved while
	 * it is empty; one the server holds is, emptied or not, or reopening it would bring back what
	 * the person took out.
	 */
	unsaved(): boolean;
	/** Saves the open draft, again when asked to meanwhile, never two saves at once. */
	save(): Promise<MailErrorCode | null>;
	/** The save under way, if any. */
	pending(): Promise<MailErrorCode | null> | undefined;
	/** Saves the open draft after a quiet moment. */
	schedule(): void;
	/** Drops the save waiting for its quiet moment. */
	cancel(): void;
	/** Counts an edit of the open draft. */
	edited(): void;
	/** How many edits the open draft has had, to tell whether more came since. */
	revision(): number;
	/** A window opened on `draft`: saved already when the server holds it (it has an id). */
	opened(draft: Draft): void;
}

/** The saving of `core`'s compose window; `sending` is true while its message is on its way. */
export function createAutosave(core: ClientCore, sending: () => boolean): Autosave {
	let timer: unknown;
	let saving: Promise<MailErrorCode | null> | undefined;
	let again = false;
	/** Edits made in the open window, and how many of them the server's copy holds (-1: none). */
	let edits = 0;
	let saved = -1;

	const compose = (): ComposeState | null => core.state.compose;
	const unsaved = (): boolean => {
		const current = compose();
		if (!current || saved === edits) return false;
		// The Bcc addresses an identity adds by itself are no edit: any identity's, as the window may
		// have changed its From since.
		const ownBcc = core.state.identities.flatMap((identity) => identity.bcc);
		return !!current.draft.id || !isEmptyDraft(current.draft, ownBcc);
	};

	/** Saves the open draft once if it has unsaved edits; resolves to the error, if it failed. */
	const saveOnce = async (): Promise<MailErrorCode | null> => {
		const current = compose();
		// Nothing is saved over a message on its way: what was edited meanwhile saves if it fails.
		if (!current || !unsaved() || sending()) return null;
		const revision = edits;
		patchCompose(core, { status: 'saving' });
		try {
			const { id } = await core.transport.saveDraft(current.draft);
			// A transport that kept the id saved over the copy read before: reopening must not show it.
			if (core.bodies.delete(id) && core.openId) void core.loadBodies(core.openId, false);
			const latest = compose();
			if (!latest || latest.session !== current.session) return null;
			saved = revision;
			// Edits made meanwhile stay, unsaved; the draft adopts the saved id.
			core.patch({
				compose: {
					...latest,
					draft: { ...latest.draft, id },
					status: saved === edits ? 'saved' : 'editing',
					savedAt: core.now(),
					error: null,
				},
			});
			return null;
		} catch (error) {
			const code = errorCode(error);
			if (compose()?.session === current.session)
				patchCompose(core, { status: 'error', error: code });
			return code;
		}
	};

	const cancel = (): void => {
		core.cancel(timer);
		timer = undefined;
	};

	const save = (): Promise<MailErrorCode | null> => {
		cancel();
		if (saving) {
			again = true;
			return saving;
		}
		saving = (async () => {
			try {
				let error: MailErrorCode | null;
				do {
					again = false;
					error = await saveOnce();
				} while (again);
				return error;
			} finally {
				saving = undefined;
			}
		})();
		return saving;
	};

	return {
		unsaved,
		save,
		pending: () => saving,
		schedule() {
			core.cancel(timer);
			timer = core.later(() => void save(), core.options.draftSaveMs ?? DEFAULT_SAVE_MS);
		},
		cancel,
		edited() {
			edits++;
		},
		revision: () => edits,
		opened(draft) {
			edits = 0;
			saved = draft.id ? 0 : -1;
		},
	};
}
