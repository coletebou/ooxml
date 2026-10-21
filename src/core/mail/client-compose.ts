// The compose window's actions: open a new message, a reply, a reply all or a forward; edit it;
// attach files; save the draft automatically after a quiet moment (never two saves at once); send;
// discard. Only edits the server has saved count as saved, and a window whose draft cannot be
// saved, or that has a file still uploading, stays open rather than losing it. New code.
import { errorCode, type ClientCore } from './client-core';
import type { ComposeState, MailClient } from './client-types';
import {
	composeDraft,
	draftFromMessage,
	draftRecipients,
	isEmptyDraft,
	type QuoteFormat,
} from './compose';
import { formatAddress, sameAddress, type Draft, type Identity, type MailMessage } from './model';
import { messageDate } from './threading';
import type { MailErrorCode } from './transport';

type ComposeActions = Pick<
	MailClient,
	| 'compose'
	| 'editDraft'
	| 'updateDraft'
	| 'attach'
	| 'detach'
	| 'saveDraft'
	| 'send'
	| 'discardDraft'
	| 'closeCompose'
>;

const DEFAULT_SAVE_MS = 2000;
const ADDRESS = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+$/;

/** English quote wording, for clients without a localised `quoteFormat`. */
export const ENGLISH_QUOTE_FORMAT: QuoteFormat = {
	attribution: (source) =>
		`On ${new Date(messageDate(source)).toUTCString()}, ${source.from[0] ? formatAddress(source.from[0]) : 'someone'} wrote:`,
	forwardHeader: (source) => [
		'---------- Forwarded message ----------',
		`From: ${source.from.map(formatAddress).join(', ')}`,
		`Date: ${new Date(messageDate(source)).toUTCString()}`,
		`Subject: ${source.subject}`,
		`To: ${source.to.map(formatAddress).join(', ')}`,
		...(source.cc.length ? [`Cc: ${source.cc.map(formatAddress).join(', ')}`] : []),
	],
};

export function createCompose(core: ClientCore): ComposeActions {
	let timer: unknown;
	let saving: Promise<MailErrorCode | null> | undefined;
	let again = false;
	let session = 0;
	/** Edits made in the open window, and how many of them the server's copy holds (-1: none). */
	let edits = 0;
	let saved = -1;

	const compose = (): ComposeState | null => core.state.compose;
	const setCompose = (next: Partial<ComposeState>): void => {
		const current = compose();
		if (current) core.patch({ compose: { ...current, ...next } });
	};
	/** The open draft has edits the server does not hold yet (an empty draft is never saved). */
	const unsaved = (): boolean => {
		const current = compose();
		return !!current && saved !== edits && !isEmptyDraft(current.draft);
	};
	const identities = (): readonly Identity[] => core.state.identities;
	/** For an answer, the identity the original was sent to; else the first. */
	const identityFor = (source: MailMessage | null): Identity | null => {
		const recipients = source ? [...source.to, ...source.cc, ...source.bcc] : [];
		return (
			identities().find((identity) => recipients.some((r) => sameAddress(r, identity.email))) ??
			identities()[0] ??
			null
		);
	};
	const source = async (emailId: string): Promise<MailMessage> => {
		const cached = core.bodies.get(emailId);
		if (cached) return cached;
		const message = await core.transport.message(emailId);
		core.keepBody(message);
		return message;
	};

	/** Saves the open draft once if it has unsaved edits; resolves to the error, if it failed. */
	const saveOnce = async (): Promise<MailErrorCode | null> => {
		const current = compose();
		if (!current || !unsaved()) return null;
		const revision = edits;
		setCompose({ status: 'saving' });
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
			if (compose()?.session === current.session) setCompose({ status: 'error', error: code });
			return code;
		}
	};

	/** Saves the open draft, again when asked to meanwhile, never two saves at once. */
	const save = (): Promise<MailErrorCode | null> => {
		core.cancel(timer);
		timer = undefined;
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

	const schedule = (): void => {
		core.cancel(timer);
		timer = core.later(() => void save(), core.options.draftSaveMs ?? DEFAULT_SAVE_MS);
	};

	/** Shows an edit of the open draft and saves it after a quiet moment. */
	const edit = (draft: Draft): void => {
		edits++;
		setCompose({ draft, status: 'editing' });
		schedule();
	};

	const start = (draft: Draft, mode: ComposeState['mode']): void => {
		edits = 0;
		saved = draft.id ? 0 : -1;
		core.patch({
			compose: {
				session: ++session,
				mode,
				draft,
				status: draft.id ? 'saved' : 'editing',
				savedAt: null,
				error: null,
				uploading: 0,
			},
		});
	};

	/**
	 * Closes the window once the server holds its last edit; a draft it cannot save stays open, and
	 * so does one with a file still uploading (the file joins the draft once it is up).
	 */
	const close = async (): Promise<boolean> => {
		if (!compose()) return true;
		while (unsaved()) {
			const error = await save();
			if (error) {
				core.notice({ kind: 'error', action: 'save', code: error });
				return false;
			}
		}
		// Closing now would leave the file out: `attach` finds no window to add it to.
		if (compose()?.uploading) return false;
		core.cancel(timer);
		timer = undefined;
		core.patch({ compose: null });
		return true;
	};

	return {
		async compose(mode, emailId) {
			try {
				const original = emailId ? await source(emailId) : null;
				const me = identities().map((identity) => ({ name: identity.name, email: identity.email }));
				const draft = composeDraft(mode, original, {
					identity: identityFor(original),
					me,
					format: core.options.quoteFormat ?? ENGLISH_QUOTE_FORMAT,
				});
				if (!(await close())) return false;
				start(draft, mode);
				return true;
			} catch (error) {
				core.fail('open', error);
				return false;
			}
		},
		async editDraft(emailId) {
			if (compose()?.draft.id === emailId) return true;
			try {
				const message = await source(emailId);
				const from = message.from[0];
				const identity = identities().find((i) => from && sameAddress(i.email, from));
				if (!(await close())) return false;
				start(draftFromMessage(message, identity), 'new');
				return true;
			} catch (error) {
				core.fail('open', error);
				return false;
			}
		},
		updateDraft(patch) {
			const current = compose();
			if (current) edit({ ...current.draft, ...patch });
		},
		async attach(files) {
			const owner = compose()?.session;
			if (owner === undefined || !files.length) return;
			// The window the files were added to, while it is open: it may close or give way meanwhile.
			const owned = (): ComposeState | null => {
				const current = compose();
				return current?.session === owner ? current : null;
			};
			setCompose({ uploading: (compose()?.uploading ?? 0) + files.length });
			for (const file of files) {
				try {
					const blob = await core.transport.upload(
						file.bytes,
						file.type || 'application/octet-stream',
					);
					const current = owned();
					if (!current) return;
					const attachment = {
						blobId: blob.blobId,
						name: file.name,
						type: blob.type,
						size: blob.size,
					};
					edit({ ...current.draft, attachments: [...current.draft.attachments, attachment] });
				} catch (error) {
					core.fail('upload', error);
				} finally {
					const current = owned();
					if (current) setCompose({ uploading: Math.max(0, current.uploading - 1) });
				}
			}
		},
		detach(blobId) {
			const current = compose();
			if (!current) return;
			edit({
				...current.draft,
				attachments: current.draft.attachments.filter((a) => a.blobId !== blobId),
			});
		},
		async saveDraft() {
			await save();
		},
		async send() {
			const current = compose();
			// Not while a file uploads: it would be left out, with no window left to add it to.
			if (!current || current.status === 'sending' || current.uploading) return false;
			const recipients = draftRecipients(current.draft);
			if (!recipients.length || recipients.some((r) => !ADDRESS.test(r.email))) {
				setCompose({ status: 'error', error: 'invalid' });
				return false;
			}
			core.cancel(timer);
			if (saving) await saving;
			const latest = compose();
			if (!latest) return false;
			if (latest.uploading) {
				// A file added while the last save finished: not yet either, and the edits keep saving.
				if (unsaved()) schedule();
				return false;
			}
			setCompose({ status: 'sending', error: null });
			try {
				await core.transport.send(latest.draft);
				core.patch({ compose: null });
				core.notice({ kind: 'done', action: 'sent', count: 1 });
				return true;
			} catch (error) {
				setCompose({ status: 'error', error: errorCode(error) });
				core.fail('send', error);
				return false;
			}
		},
		async discardDraft() {
			const current = compose();
			core.cancel(timer);
			if (saving) await saving;
			const id = compose()?.draft.id ?? current?.draft.id;
			core.patch({ compose: null });
			if (!id) return;
			try {
				await core.transport.destroy([id]);
				core.notice({ kind: 'done', action: 'discarded', count: 1 });
			} catch (error) {
				core.fail('delete', error);
			}
		},
		closeCompose: close,
	};
}
