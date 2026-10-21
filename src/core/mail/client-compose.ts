// The compose window's actions: open a new message, a reply, a reply all or a forward; edit it;
// attach files; send; discard. The draft is saved after a quiet moment (`client-autosave.ts`), and
// a window whose draft cannot be saved, or that has a file still uploading, stays open rather than
// losing it. A window whose message is on its way gives way to nothing until it is sent. New code.
import { createAutosave, patchCompose } from './client-autosave';
import { errorCode, type ClientCore } from './client-core';
import type { ComposeState, MailClient } from './client-types';
import { composeDraft, draftFromMessage, draftRecipients, type QuoteFormat } from './compose';
import { formatAddress, identityFor, type Draft, type Identity, type MailMessage } from './model';
import { messageDate } from './threading';

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
	/** The send under way, resolving to whether the message went. */
	let sending: Promise<boolean> | undefined;
	let session = 0;
	const autosave = createAutosave(core, () => !!sending);

	const compose = (): ComposeState | null => core.state.compose;
	const setCompose = (next: Partial<ComposeState>): void => patchCompose(core, next);
	const identities = (): readonly Identity[] => core.state.identities;
	/**
	 * True when the person sent `message`: it is filed in Sent, as the list knows it now (a body
	 * read before keeps the folders it had then).
	 */
	const isSent = (message: MailMessage): boolean => {
		const sent = core.mailboxByRole('sent');
		const boxes = core.emails.get(message.id)?.mailboxIds ?? message.mailboxIds;
		return !!sent && boxes.includes(sent.id);
	};
	/** A message to answer or edit, whole: a body the reading pane holds cut short is read again. */
	const source = async (emailId: string): Promise<MailMessage> => {
		const cached = core.bodies.get(emailId);
		if (cached && !cached.truncated) return cached;
		const message = await core.transport.message(emailId, { whole: true });
		core.keepBody(message);
		return message;
	};

	/**
	 * Shows an edit of the open draft and saves it after a quiet moment. An edit made while the
	 * message is on its way is not in it: the window stays sending (Send off, nothing saved over
	 * the message), closes once it is sent, and keeps the edit, to save, if the send fails.
	 */
	const edit = (draft: Draft): void => {
		autosave.edited();
		if (sending) {
			setCompose({ draft });
			return;
		}
		setCompose({ draft, status: 'editing' });
		autosave.schedule();
	};

	/**
	 * Sends the draft of `open`, the window shown: it closes once the message is sent, and shows the
	 * error if that fails, saving what was edited meanwhile. Nothing replaces it until then (`close`
	 * waits), so the window is still this one; that is checked all the same before it is changed.
	 */
	const deliver = async (open: ComposeState): Promise<boolean> => {
		const revision = autosave.revision();
		autosave.cancel();
		setCompose({ status: 'sending', error: null });
		const own = (): boolean => compose()?.session === open.session;
		try {
			await core.transport.send(open.draft);
		} catch (error) {
			if (own()) {
				setCompose({ status: 'error', error: errorCode(error) });
				if (autosave.revision() !== revision) autosave.schedule();
			}
			core.fail('send', error);
			return false;
		}
		if (own()) core.patch({ compose: null });
		core.notice({ kind: 'done', action: 'sent', count: 1 });
		return true;
	};

	const start = (draft: Draft, mode: ComposeState['mode']): void => {
		autosave.opened(draft);
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
	 * so does one with a file still uploading (the file joins the draft once it is up). One whose
	 * message is on its way closes once it is sent, and stays open with its error if that fails.
	 */
	const close = async (): Promise<boolean> => {
		for (;;) {
			if (!compose()) return true;
			if (sending) {
				if (!(await sending)) return false;
				continue;
			}
			if (!autosave.unsaved()) break;
			const error = await autosave.save();
			if (error) {
				core.notice({ kind: 'error', action: 'save', code: error });
				return false;
			}
		}
		// Closing now would leave the file out: `attach` finds no window to add it to.
		if (compose()?.uploading) return false;
		autosave.cancel();
		core.patch({ compose: null });
		return true;
	};

	return {
		async compose(mode, emailId) {
			try {
				const original = emailId ? await source(emailId) : null;
				const me = identities().map((identity) => ({ name: identity.name, email: identity.email }));
				const sent = !!original && isSent(original);
				// For an answer, the identity the original was sent to, else for a message the person
				// sent the one it was sent from; else the first.
				const addresses = original
					? [...original.to, ...original.cc, ...original.bcc, ...(sent ? original.from : [])]
					: [];
				const { draftHtml } = core.options;
				const draft = composeDraft(mode, original, {
					identity: identityFor(identities(), addresses) ?? identities()[0] ?? null,
					me,
					format: core.options.quoteFormat ?? ENGLISH_QUOTE_FORMAT,
					sent,
					...(draftHtml ? { draftHtml } : {}),
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
				const identity = identityFor(identities(), message.from.slice(0, 1));
				if (!(await close())) return false;
				start(draftFromMessage(message, identity, core.options.draftHtml), 'new');
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
			await autosave.save();
		},
		async send() {
			const current = compose();
			// Not while a file uploads: it would be left out, with no window left to add it to.
			if (!current || sending || current.uploading) return false;
			const recipients = draftRecipients(current.draft);
			if (!recipients.length || recipients.some((r) => !ADDRESS.test(r.email))) {
				setCompose({ status: 'error', error: 'invalid' });
				return false;
			}
			autosave.cancel();
			const saving = autosave.pending();
			if (saving) await saving;
			const latest = compose();
			// Given way to another window meanwhile, which was not asked to send, or sent already by a
			// Send pressed while the same save finished.
			if (!latest || latest.session !== current.session || sending) return false;
			if (latest.uploading) {
				// A file added while the last save finished: not yet either, and the edits keep saving.
				if (autosave.unsaved()) autosave.schedule();
				return false;
			}
			sending = deliver(latest);
			try {
				return await sending;
			} finally {
				sending = undefined;
			}
		},
		async discardDraft() {
			const current = compose();
			autosave.cancel();
			const saving = autosave.pending();
			if (saving) await saving;
			// A message on its way is no draft any more; one whose send fails stays open to decide on.
			if (sending) return;
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
