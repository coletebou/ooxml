// The compose window's actions: open a new message, a reply, a reply all or a forward; edit it;
// attach files; save the draft automatically after a quiet moment (never two saves at once); send;
// discard. Also the file actions on messages: download an attachment, export and import `.eml`.
// New code.
import type { ClientCore } from './client-core';
import type { ListLoader } from './client-list';
import type { ComposeState, FileInput, MailClient } from './client-types';
import { composeDraft, isEmptyDraft, type QuoteFormat } from './compose';
import { emlFileName } from './eml';
import { formatAddress, sameAddress, type Draft, type Identity, type MailMessage } from './model';
import { MailTransportError } from './transport';

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
	| 'download'
	| 'exportEml'
	| 'importEml'
>;

const DEFAULT_SAVE_MS = 2000;
const ADDRESS = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+$/;

/** English quote wording, for clients without a localised `quoteFormat`. */
export const ENGLISH_QUOTE_FORMAT: QuoteFormat = {
	attribution: (source) =>
		`On ${new Date(source.sentAt ?? source.receivedAt).toUTCString()}, ${source.from[0] ? formatAddress(source.from[0]) : 'someone'} wrote:`,
	forwardHeader: (source) => [
		'---------- Forwarded message ----------',
		`From: ${source.from.map(formatAddress).join(', ')}`,
		`Date: ${new Date(source.sentAt ?? source.receivedAt).toUTCString()}`,
		`Subject: ${source.subject}`,
		`To: ${source.to.map(formatAddress).join(', ')}`,
		...(source.cc.length ? [`Cc: ${source.cc.map(formatAddress).join(', ')}`] : []),
	],
};

export function createCompose(core: ClientCore, list: ListLoader): ComposeActions {
	let timer: unknown;
	let saving: Promise<void> | undefined;
	let again = false;
	let session = 0;

	const compose = (): ComposeState | null => core.state.compose;
	const setCompose = (next: Partial<ComposeState>): void => {
		const current = compose();
		if (current) core.patch({ compose: { ...current, ...next } });
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

	const save = async (): Promise<void> => {
		core.cancel(timer);
		timer = undefined;
		if (saving) {
			again = true;
			return saving;
		}
		const current = compose();
		if (!current || isEmptyDraft(current.draft)) return;
		setCompose({ status: 'saving' });
		saving = (async () => {
			try {
				const { id } = await core.transport.saveDraft(current.draft);
				// The draft may have been edited meanwhile: keep the edits, adopt the id.
				const latest = compose();
				if (latest) {
					core.patch({
						compose: {
							...latest,
							draft: { ...latest.draft, id },
							status: again ? 'editing' : 'saved',
							savedAt: core.now(),
							error: null,
						},
					});
				}
			} catch (error) {
				setCompose({
					status: 'error',
					error: error instanceof MailTransportError ? error.code : 'server',
				});
			} finally {
				saving = undefined;
			}
			if (again) {
				again = false;
				await save();
			}
		})();
		return saving;
	};

	const schedule = (): void => {
		core.cancel(timer);
		timer = core.later(() => void save(), core.options.draftSaveMs ?? DEFAULT_SAVE_MS);
	};

	const start = (draft: Draft, mode: ComposeState['mode']): void => {
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

	const close = async (keep: boolean): Promise<void> => {
		const current = compose();
		if (!current) return;
		if (keep && current.status !== 'saved' && !isEmptyDraft(current.draft)) await save();
		else core.cancel(timer);
		timer = undefined;
		core.patch({ compose: null });
	};

	return {
		async compose(mode, emailId) {
			await close(true);
			try {
				const original = emailId ? await source(emailId) : null;
				const me = identities().map((identity) => ({ name: identity.name, email: identity.email }));
				const draft = composeDraft(mode, original, {
					identity: identityFor(original),
					me,
					format: core.options.quoteFormat ?? ENGLISH_QUOTE_FORMAT,
				});
				start(draft, mode);
			} catch (error) {
				core.fail('open', error);
			}
		},
		async editDraft(emailId) {
			await close(true);
			try {
				const message = await source(emailId);
				const from = message.from[0];
				const identity = identities().find((i) => from && sameAddress(i.email, from));
				start(
					{
						id: message.id,
						...(identity ? { identityId: identity.id } : {}),
						...(from ? { from } : {}),
						to: message.to,
						cc: message.cc,
						bcc: message.bcc,
						subject: message.subject,
						text: message.text ?? '',
						...(message.html ? { html: message.html } : {}),
						attachments: message.attachments.map(({ blobId, name, type, size }) => ({
							blobId,
							name,
							type,
							size,
						})),
						inReplyTo: message.inReplyTo,
						references: message.references,
					},
					'new',
				);
			} catch (error) {
				core.fail('open', error);
			}
		},
		updateDraft(patch) {
			const current = compose();
			if (!current) return;
			setCompose({ draft: { ...current.draft, ...patch }, status: 'editing' });
			schedule();
		},
		async attach(files) {
			if (!compose() || !files.length) return;
			setCompose({ uploading: (compose()?.uploading ?? 0) + files.length });
			for (const file of files) {
				try {
					const blob = await core.transport.upload(
						file.bytes,
						file.type || 'application/octet-stream',
					);
					const current = compose();
					if (!current) return;
					const attachment = {
						blobId: blob.blobId,
						name: file.name,
						type: blob.type,
						size: blob.size,
					};
					setCompose({
						draft: { ...current.draft, attachments: [...current.draft.attachments, attachment] },
					});
				} catch (error) {
					core.fail('upload', error);
				} finally {
					setCompose({ uploading: Math.max(0, (compose()?.uploading ?? 1) - 1) });
				}
			}
			schedule();
		},
		detach(blobId) {
			const current = compose();
			if (!current) return;
			setCompose({
				draft: {
					...current.draft,
					attachments: current.draft.attachments.filter((a) => a.blobId !== blobId),
				},
				status: 'editing',
			});
			schedule();
		},
		saveDraft: save,
		async send() {
			const current = compose();
			if (!current || current.status === 'sending') return false;
			const recipients = [...current.draft.to, ...current.draft.cc, ...current.draft.bcc];
			if (!recipients.length || recipients.some((r) => !ADDRESS.test(r.email))) {
				setCompose({ status: 'error', error: 'invalid' });
				return false;
			}
			core.cancel(timer);
			if (saving) await saving;
			const latest = compose();
			if (!latest) return false;
			setCompose({ status: 'sending', error: null });
			try {
				await core.transport.send(latest.draft);
				core.patch({ compose: null });
				core.notice({ kind: 'done', action: 'sent', count: 1 });
				return true;
			} catch (error) {
				setCompose({
					status: 'error',
					error: error instanceof MailTransportError ? error.code : 'server',
				});
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
		closeCompose: () => close(true),
		async download(attachment) {
			try {
				return await core.transport.download(attachment.blobId, {
					type: attachment.type,
					name: attachment.name,
				});
			} catch (error) {
				core.fail('download', error);
				throw error;
			}
		},
		async exportEml(emailId) {
			const email =
				core.emails.get(emailId) ??
				core.bodies.get(emailId) ??
				(await core.transport.message(emailId));
			const name = emlFileName(email.subject);
			const bytes = await core.transport.download(email.blobId, { type: 'message/rfc822', name });
			return { name, type: 'message/rfc822', bytes };
		},
		async importEml(files: readonly FileInput[], mailboxId) {
			const target = mailboxId ?? core.state.mailboxId ?? core.mailboxByRole('inbox')?.id;
			if (!target || !files.length) return;
			let count = 0;
			for (const file of files) {
				try {
					await core.transport.importMessage(file.bytes, target);
					count++;
				} catch (error) {
					core.fail('import', error);
				}
			}
			if (count) {
				core.notice({ kind: 'done', action: 'imported', count });
				await list.loadList();
			}
		},
	};
}
