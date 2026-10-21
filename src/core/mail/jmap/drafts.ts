// Saving and sending drafts. A save creates the new draft and destroys the previous one; a send also
// submits it (RFC 8621 7.5), moves it from Drafts to Sent and marks what it answers or forwards, in
// one request. The clean-up only runs when the step before it succeeded: a `Core/echo` refers to
// the created id, so it fails when there is none, and the call reading the echo fails with it
// (RFC 8620 3.7, 4). A refused message therefore never costs the saved draft. A server that does
// not resolve references in an echo gets the clean-up as a second request instead. New code.
import { ANSWERED, DRAFT, FORWARDED, SEEN, type Draft, type Identity } from '../model';
import { MailTransportError } from '../transport';
import type { JmapClient } from './client';
import type { MailboxMethods } from './mailboxes';
import { emailToCreate, pickIdentity } from './outgoing';
import { patchPath, type JmapCall, type JmapResult } from './request';
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
			const gated = previous !== undefined && (await canGate());
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
			const gated = cleanUp && (await canGate());
			const { result, calls } = await client.request((builder, accountId) => {
				const email = builder.call('Email/set', { accountId, create: { draft: create } });
				const submission = builder.call('EmailSubmission/set', {
					accountId,
					create: { send: { identityId: identity.id, emailId: '#draft' } },
					onSuccessUpdateEmail: { '#send': onSent },
				});
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
			const id = result.created(calls.email, 'draft');
			try {
				result.created(calls.submission, 'send');
			} catch (error) {
				// Not sent: drop the copy just made, so the saved draft is the only one again.
				await quietly(() => tidy([id], {}));
				nudge();
				throw error;
			}
			const later = { destroy: [] as string[], update: {} as Record<string, Patch> };
			if (cleanUp && (!calls.clean || result.error(calls.clean))) {
				later.destroy.push(...destroy);
				Object.assign(later.update, marks);
			}
			if (!filed(result, calls.submission, id)) later.update[id] = onSent;
			await quietly(() => tidy(later.destroy, later.update));
			nudge();
			return { id };
		},
	};
}
