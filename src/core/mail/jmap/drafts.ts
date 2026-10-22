// Saving and sending drafts. A save creates the new draft and destroys the previous one; a send also
// submits it (RFC 8621 7.5), moves it from Drafts to Sent and marks what it answers or forwards, in
// one request. The clean-up only runs when the step before it succeeded: a `Core/echo` refers to
// the created id, so it fails when there is none, and the call reading the echo fails with it
// (RFC 8620 3.7, 4). A refused message therefore never costs the saved draft. A server that does
// not resolve references in an echo, or takes fewer calls in one request than that needs
// (`maxCallsInRequest`), gets the clean-up as a second request instead, and with one call per
// request the submission too. The copy a send made is destroyed only when it certainly did not go
// out (the server refused it, or the request as a whole, RFC 8620 3.6); when that is not known it
// stays, and the send fails as `uncertain` rather than as not sent (`submission.ts`). So does a
// request that creates and submits the message at once and gets no answer: the copy's id never
// came, but every send gives its message a Message-ID of its own (RFC 8621 4.1.2.5, 4.6), by which
// the copy is looked for (the `header` condition, 4.4.1). The same message sent again then first
// asks the server whether that copy went out (RFC 8621 7.3), and is sent again only when the
// server says it did not, has neither the copy nor a submission of it any more (a search for the
// Message-ID finds no copy, when the id never came), or cannot search by header field
// (`unsupportedFilter`), so it can never say; while the server cannot be asked, nothing is sent.
// That is known in memory only: a reload forgets it, and a message changed since is a new one.
// New code.
import { ANSWERED, DRAFT, FORWARDED, SEEN, type Draft, type Identity } from '../model';
import { MailTransportError } from '../transport';
import type { JmapClient } from './client';
import type { MailboxMethods } from './mailboxes';
import { emailToCreate, messageIdFor, pickIdentity } from './outgoing';
import { patchPath, type JmapCall, type JmapRequestBuilder, type JmapResult } from './request';
import { copyWithId, refused, uncertain, unprocessed, wentOut } from './submission';
import { isRecord } from './types';

type Patch = Record<string, true | null>;

/** The copy a send whose submission was not certain made: its id, or the Message-ID it gave it. */
type UnsureCopy = { emailId: string } | { messageId: string };

export interface DraftOptions {
	client: JmapClient;
	mailboxes: MailboxMethods;
	/** The identities to write as; empty when the account cannot send. */
	identities(): Promise<readonly Identity[]>;
	canSend(): Promise<boolean>;
	nudge(): void;
}

export interface DraftMethods {
	saveDraft(draft: Draft): Promise<{ id: string }>;
	send(draft: Draft): Promise<{ id: string }>;
}

async function quietly(work: () => Promise<unknown>): Promise<void> {
	try {
		await work();
	} catch {
		// Best effort: the save or send itself already succeeded or failed on its own terms.
	}
}

/** `$answered` on the message a reply answers, `$forwarded` on the one a forward forwards. */
function markPatches(draft: Draft): Record<string, Patch> {
	const marks = new Map<string, Patch>();
	const mark = (id: string | undefined, keyword: string): void => {
		if (id) marks.set(id, { ...marks.get(id), [patchPath('keywords', keyword)]: true });
	};
	mark(draft.replyToEmailId, ANSWERED);
	mark(draft.forwardOfEmailId, FORWARDED);
	return Object.fromEntries(marks);
}

/** True when the implicit `Email/set` of `onSuccessUpdateEmail` moved `id` to Sent. */
function filed(result: JmapResult, submission: JmapCall, id: string): boolean {
	const implicit = result.all(submission).find((response) => response[0] === 'Email/set');
	const updated = implicit?.[1].updated;
	return isRecord(updated) && Object.hasOwn(updated, id);
}

export function createDraftMethods(options: DraftOptions): DraftMethods {
	const { client, mailboxes, nudge } = options;
	let gating: Promise<boolean> | null = null;

	/**
	 * Whether the server resolves a result reference inside `Core/echo`. Asked once; only a request
	 * that failed as a whole is asked again.
	 */
	const canGate = (): Promise<boolean> =>
		(gating ??= client
			.request((builder) => {
				const first = builder.call('Core/echo', { value: ['resolved'] });
				return builder.call('Core/echo', { value: first.ref('/value') });
			})
			.then(({ result, calls }) => {
				const value = result.error(calls) ? undefined : result.get(calls).value;
				return Array.isArray(value) && value[0] === 'resolved';
			})
			.catch(() => {
				gating = null;
				return false;
			}));

	const tidy = async (destroy: readonly string[], update: Readonly<Record<string, Patch>>) => {
		if (!destroy.length && !Object.keys(update).length) return;
		const { result, calls } = await client.request((builder, accountId) =>
			builder.call('Email/set', {
				accountId,
				destroy: destroy.length ? destroy : undefined,
				update: Object.keys(update).length ? update : undefined,
			}),
		);
		result.get(calls);
	};

	/**
	 * Which of `ids` are still drafts, as `editDraft` opens them: marked `$draft`, or filed in Drafts
	 * and not in Sent where the account has a Sent folder. Only those are destroyed when a save or a
	 * send replaces them: another device may have sent the draft since the window opened it, and
	 * its Sent copy must never go. Nothing is destroyed when the server cannot say.
	 */
	const stillDrafts = async (ids: readonly string[]): Promise<string[]> => {
		if (!ids.length) return [];
		try {
			const drafts = await draftsMailbox();
			const sent = await mailboxes.roleId('sent');
			const { result, calls } = await client.request((builder, accountId) =>
				builder.call('Email/get', { accountId, ids, properties: ['keywords', 'mailboxIds'] }),
			);
			const list: unknown = result.get(calls).list;
			return (Array.isArray(list) ? list : []).flatMap((email: unknown) => {
				if (!isRecord(email) || typeof email.id !== 'string') return [];
				const keywords = isRecord(email.keywords) ? email.keywords : {};
				const boxes = isRecord(email.mailboxIds) ? email.mailboxIds : {};
				const filed = !!sent && boxes[drafts] === true && boxes[sent] !== true;
				return keywords[DRAFT] === true || filed ? [email.id] : [];
			});
		} catch {
			return [];
		}
	};

	/** The calls one request may hold (`maxCallsInRequest`, RFC 8620 2): 16 is only a suggestion. */
	const maxCalls = async (): Promise<number> => (await client.session()).limits.maxCallsInRequest;

	/**
	 * Copies whose submission may or may not have happened, by the message they hold (`sendKey`):
	 * each stays until the server can say whether it went out, so sending it again asks first.
	 */
	const unsure = new Map<string, UnsureCopy>();
	/** The message a send of the draft `draftId` makes: the draft, the identity and the content. */
	const sendKey = (draftId: string | undefined, identityId: string, create: unknown): string =>
		JSON.stringify([draftId ?? null, identityId, create]);

	/**
	 * Whether the copy an earlier send of the message `key` made went out (`wentOut`); when its id
	 * never came, the copy is found by its Message-ID (`copyWithId`, `boxes` being Drafts and Sent).
	 * Null when the server holds no such copy or cannot look for it. A copy found stays known by its
	 * id. Throws while the server cannot be asked.
	 */
	const ask = async (key: string, earlier: UnsureCopy, boxes: readonly string[]) => {
		const copy =
			'emailId' in earlier ? earlier.emailId : await copyWithId(client, earlier.messageId, boxes);
		if (copy === null) return null;
		unsure.set(key, { emailId: copy });
		return { copy, went: await wentOut(client, copy) };
	};

	const draftsMailbox = async (): Promise<string> => {
		const id = await mailboxes.roleId('drafts');
		if (!id) throw new MailTransportError('notFound', 'The account has no Drafts folder.');
		return id;
	};

	const identitiesOrNone = async (): Promise<readonly Identity[]> => {
		try {
			return await options.identities();
		} catch {
			return [];
		}
	};

	return {
		async saveDraft(draft) {
			const drafts = await draftsMailbox();
			const identity = pickIdentity(await identitiesOrNone(), draft);
			const create = emailToCreate(draft, drafts, [DRAFT, SEEN], identity);
			const previous = draft.id;
			const replaced = previous === undefined ? [] : await stillDrafts([previous]);
			// Saved, and the previous one destroyed, in one request of three calls when it is taken.
			const gated = replaced.length > 0 && (await maxCalls()) >= 3 && (await canGate());
			const { result, calls } = await client.request((builder, accountId) => {
				const save = builder.call('Email/set', { accountId, create: { draft: create } });
				if (!gated) return { save, clean: null };
				const echo = builder.call('Core/echo', {
					saved: save.ref('/created/draft/id'),
					destroy: replaced,
				});
				return {
					save,
					clean: builder.call('Email/set', { accountId, destroy: echo.ref('/destroy') }),
				};
			});
			const id = result.created(calls.save, 'draft');
			if (replaced.length && (!calls.clean || result.error(calls.clean)))
				await quietly(() => tidy(replaced, {}));
			// A message a send left unsure of, saved unchanged, is still that message: its next send,
			// from the new draft, asks about the first one too.
			const before = identity ? sendKey(previous, identity.id, create) : '';
			const copy = unsure.get(before);
			if (identity && copy && unsure.delete(before))
				unsure.set(sendKey(id, identity.id, create), copy);
			nudge();
			return { id };
		},

		async send(draft) {
			if (!(await options.canSend()))
				throw new MailTransportError('unsupported', 'The account cannot send mail.');
			const identity = pickIdentity(await options.identities(), draft);
			if (!identity)
				throw new MailTransportError('forbidden', 'The account has no identity to send as.');
			const drafts = await draftsMailbox();
			const sent = await mailboxes.roleId('sent');
			const create = emailToCreate(draft, drafts, [DRAFT, SEEN], identity);
			// RFC 8621 7.5.1: once submitted, out of Drafts, into Sent, no longer a draft. Without a
			// Sent folder the message stays in Drafts rather than in no mailbox at all.
			const onSent: Patch = sent
				? {
						[patchPath('mailboxIds', drafts)]: null,
						[patchPath('mailboxIds', sent)]: true,
						[patchPath('keywords', DRAFT)]: null,
					}
				: { [patchPath('keywords', DRAFT)]: null };
			const destroy = draft.id === undefined ? [] : await stillDrafts([draft.id]);
			const marks = markPatches(draft);
			const cleanUp = destroy.length > 0 || Object.keys(marks).length > 0;
			const key = sendKey(draft.id, identity.id, create);
			const earlier = unsure.get(key);
			if (earlier !== undefined) {
				// Asked before anything is sent: while the server cannot be asked, it is still not known,
				// nothing is sent and the copy stays known for the next send.
				const boxes = sent ? [drafts, sent] : [drafts];
				const asked = await ask(key, earlier, boxes).catch((error: unknown) => {
					throw uncertain(error);
				});
				unsure.delete(key);
				if (asked?.went) {
					// It went out the first time: that send is finished, never made again.
					await quietly(() => tidy(destroy, { ...marks, [asked.copy]: onSent }));
					nudge();
					return { id: asked.copy };
				}
				// It did not: that copy is a stray draft. When the server can never say (it has neither
				// the copy nor a submission of it, or cannot look for it), the message is sent again.
				if (asked?.went === false) await quietly(() => tidy([asked.copy], {}));
			}
			const limit = await maxCalls();
			// Created, submitted and cleaned up in one request of four calls when it is taken.
			const gated = cleanUp && limit >= 4 && (await canGate());
			const submit = (builder: JmapRequestBuilder, accountId: string, emailId: string) =>
				builder.call('EmailSubmission/set', {
					accountId,
					create: { send: { identityId: identity.id, emailId } },
					onSuccessUpdateEmail: { '#send': onSent },
				});
			// Its own Message-ID: the copy is found by it when no answer says what the copy's id is.
			const messageId = messageIdFor(draft, identity);
			const message = { ...create, messageId: [messageId] };
			const first = await client
				.request((builder, accountId) => {
					const email = builder.call('Email/set', { accountId, create: { draft: message } });
					if (limit < 2) return { email, submission: null, clean: null };
					const submission = submit(builder, accountId, '#draft');
					if (!gated) return { email, submission, clean: null };
					const echo = builder.call('Core/echo', {
						sent: submission.ref('/created/send/id'),
						destroy,
						update: marks,
					});
					const clean = builder.call('Email/set', {
						accountId,
						destroy: destroy.length ? echo.ref('/destroy') : undefined,
						update: Object.keys(marks).length ? echo.ref('/update') : undefined,
					});
					return { email, submission, clean };
				})
				.catch((error: unknown) => {
					// Created and submitted at once, it may have gone out though no answer came, unless the
					// server refused the request as a whole (RFC 8620 3.6): the next send of it looks for
					// the copy by its Message-ID.
					if (limit < 2 || unprocessed(error)) throw error;
					unsure.set(key, { messageId });
					nudge();
					throw uncertain(error);
				});
			// Not created: nothing was sent and the saved draft is untouched.
			const id = first.result.created(first.calls.email, 'draft');
			/**
			 * Ends a send that did not go through. Not sent for certain: the copy just made goes, so the
			 * saved draft is the only one again. When it may have gone out, the copy may be the only one
			 * there is: it stays, known for the next send to ask about.
			 */
			const notSent = async (error: unknown, certain: boolean): Promise<never> => {
				if (certain) await quietly(() => tidy([id], {}));
				else unsure.set(key, { emailId: id });
				nudge();
				throw certain ? error : uncertain(error);
			};
			// One call per request: the submission names the message the first one created. A request
			// the server refused as a whole changed nothing; any other failure of it leaves open
			// whether the message went out.
			const { result, calls: submission } = first.calls.submission
				? { result: first.result, calls: first.calls.submission }
				: await client
						.request((builder, accountId) => submit(builder, accountId, id))
						.catch((error: unknown) => notSent(error, unprocessed(error)));
			try {
				result.created(submission, 'send');
			} catch (error) {
				await notSent(error, refused(result, submission, 'send'));
			}
			const { clean } = first.calls;
			const later = { destroy: [] as string[], update: {} as Record<string, Patch> };
			if (cleanUp && (!clean || first.result.error(clean))) {
				later.destroy.push(...destroy);
				Object.assign(later.update, marks);
			}
			if (!filed(result, submission, id)) later.update[id] = onSent;
			await quietly(() => tidy(later.destroy, later.update));
			nudge();
			return { id };
		},
	};
}
