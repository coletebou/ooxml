// Saving and sending drafts. A save creates the new draft and destroys the previous one; a send also
// submits it (RFC 8621 7.5), moves it from Drafts to Sent and marks what it answers or forwards, in
// one request. The clean-up only runs when the step before it succeeded: a `Core/echo` refers to
// the created id, so it fails when there is none, and the call reading the echo fails with it
// (RFC 8620 3.7, 4). A refused message therefore never costs the saved draft. A server that does
// not resolve references in an echo, or takes fewer calls in one request than that needs
// (`maxCallsInRequest`), gets the clean-up as a second request instead, and with one call per
// request the submission too. The copy a send made is destroyed only when it certainly did not go
// out (the server refused it, or the request as a whole, RFC 8620 3.6); when that is not known it
// stays, and the send fails as `uncertain` rather than as not sent (`submission.ts`). The same
// message sent again then first asks the server whether that copy went out (RFC 8621 7.3), and is
// sent again only when the server says it did not, or has neither the copy nor a submission of it
// any more; while the server cannot be asked, nothing is sent. That is known in memory only: a
// reload forgets it, and a message changed since is a new one. A request that creates and submits
// the message at once and gets no answer at all fails with why (the network, say), not as
// `uncertain`: the copy's id never came, so there is nothing to ask about. New code.
import { ANSWERED, DRAFT, FORWARDED, SEEN, type Draft, type Identity } from '../model';
import { MailTransportError } from '../transport';
import type { JmapClient } from './client';
import type { MailboxMethods } from './mailboxes';
import { emailToCreate, pickIdentity } from './outgoing';
import { patchPath, type JmapCall, type JmapRequestBuilder, type JmapResult } from './request';
import { refused, uncertain, unprocessed, wentOut } from './submission';
import { isRecord } from './types';

type Patch = Record<string, true | null>;

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

	/** The calls one request may hold (`maxCallsInRequest`, RFC 8620 2): 16 is only a suggestion. */
	const maxCalls = async (): Promise<number> => (await client.session()).limits.maxCallsInRequest;

	/**
	 * Copies whose submission may or may not have happened, by the message they hold. Each stays
	 * until the server can say whether it went out, so sending the same message again asks first.
	 */
	const unsure = new Map<string, string>();

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
			const create = emailToCreate(
				draft,
				drafts,
				[DRAFT, SEEN],
				pickIdentity(await identitiesOrNone(), draft),
			);
			const previous = draft.id;
			// Saved, and the previous one destroyed, in one request of three calls when it is taken.
			const gated = previous !== undefined && (await maxCalls()) >= 3 && (await canGate());
			const { result, calls } = await client.request((builder, accountId) => {
				const save = builder.call('Email/set', { accountId, create: { draft: create } });
				if (!gated) return { save, clean: null };
				const echo = builder.call('Core/echo', {
					saved: save.ref('/created/draft/id'),
					destroy: [previous],
				});
				return {
					save,
					clean: builder.call('Email/set', { accountId, destroy: echo.ref('/destroy') }),
				};
			});
			const id = result.created(calls.save, 'draft');
			if (previous !== undefined && (!calls.clean || result.error(calls.clean)))
				await quietly(() => tidy([previous], {}));
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
			const destroy = draft.id === undefined ? [] : [draft.id];
			const marks = markPatches(draft);
			const cleanUp = destroy.length > 0 || Object.keys(marks).length > 0;
			const key = JSON.stringify([draft.id ?? null, identity.id, create]);
			const earlier = unsure.get(key);
			if (earlier !== undefined) {
				// Asked before anything is sent: while the server cannot be asked, it is still not known,
				// nothing is sent and the copy stays known for the next send.
				const went = await wentOut(client, earlier).catch((error: unknown) => {
					throw uncertain(error);
				});
				unsure.delete(key);
				if (went) {
					// It went out the first time: that send is finished, never made again.
					await quietly(() => tidy(destroy, { ...marks, [earlier]: onSent }));
					nudge();
					return { id: earlier };
				}
				// It did not: that copy is a stray draft. When the server can never say (it has neither
				// the copy nor a submission of it), the message is sent again.
				if (went === false) await quietly(() => tidy([earlier], {}));
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
			const first = await client.request((builder, accountId) => {
				const email = builder.call('Email/set', { accountId, create: { draft: create } });
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
				else unsure.set(key, id);
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
