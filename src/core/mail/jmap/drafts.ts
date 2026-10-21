// Saving and sending drafts. A save creates the new draft and destroys the previous one; a send also
// submits it (RFC 8621 7.5), moves it from Drafts to Sent and marks what it answers or forwards, in
// one request. The clean-up only runs when the step before it succeeded: a `Core/echo` refers to
// the created id, so it fails when there is none, and the call reading the echo fails with it
// (RFC 8620 3.7, 4). A refused message therefore never costs the saved draft. A server that does
// not resolve references in an echo, or takes fewer calls in one request than that needs
// (`maxCallsInRequest`), gets the clean-up as a second request instead, and with one call per
// request the submission too. The copy a send made is destroyed only when it certainly did not go
// out; when that is not known it stays. New code.
import { ANSWERED, DRAFT, FORWARDED, SEEN, type Draft, type Identity } from '../model';
import { MailTransportError } from '../transport';
import type { JmapClient } from './client';
import type { MailboxMethods } from './mailboxes';
import { emailToCreate, pickIdentity } from './outgoing';
import { patchPath, type JmapCall, type JmapRequestBuilder, type JmapResult } from './request';
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

/**
 * True when the server certainly did not create `creationId` in `call`: it refused it (a SetError
 * in `notCreated`), or the method failed, which changes nothing unless the error is
 * `serverPartialFail` (RFC 8620 3.6.2). That error, or no answer, may mean the message went out.
 */
function refused(result: JmapResult, call: JmapCall, creationId: string): boolean {
	const error = result.error(call);
	if (error) return error.type !== 'serverPartialFail';
	const notCreated = result.all(call).find((response) => response[0] === call.name)?.[1].notCreated;
	return isRecord(notCreated) && Object.hasOwn(notCreated, creationId);
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
			// One call per request: the submission names the message the first one created. Should
			// that request fail as a whole, whether it went out is not known, and the copy stays.
			const { result, calls: submission } = first.calls.submission
				? { result: first.result, calls: first.calls.submission }
				: await client
						.request((builder, accountId) => submit(builder, accountId, id))
						.catch((error: unknown) => {
							nudge();
							throw error;
						});
			try {
				result.created(submission, 'send');
			} catch (error) {
				// Not sent for certain: drop the copy just made, so the saved draft is the only one
				// again. When it may have gone out, the copy may be the only one there is: it stays.
				if (refused(result, submission, 'send')) await quietly(() => tidy([id], {}));
				nudge();
				throw error;
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
