// Messages over JMAP (RFC 8621 4): `Email/query` for searches, `Email/get` for summaries (header
// properties only, batched by the server's limit) and for one message with its bodies, and
// `Email/set` to change keywords and mailboxes or destroy. New code.
import { DRAFT, type EmailSummary, type MailMessage } from '../model';
import {
	MailTransportError,
	PartialUpdateError,
	type EmailPatch,
	type MailQuery,
	type MailQueryPage,
	type MailQueryResult,
	type MessageReadOptions,
} from '../transport';
import type { ChangeTracker } from './changes';
import type { JmapClient } from './client';
import { objects, strings, toMessage, toSummary, type JmapObject } from './convert';
import { toJmapFilter } from './filter';
import { patchPath } from './request';
import { isRecord } from './types';

/** The `Email/get` properties a message list needs: everything but the bodies. */
export const SUMMARY_PROPERTIES: readonly string[] = [
	'id',
	'blobId',
	'threadId',
	'mailboxIds',
	'keywords',
	'size',
	'receivedAt',
	'messageId',
	'inReplyTo',
	'references',
	'from',
	'to',
	'cc',
	'bcc',
	'replyTo',
	'subject',
	'sentAt',
	'hasAttachment',
	'preview',
];

export const BODY_PROPERTIES: readonly string[] = [
	'partId',
	'blobId',
	'size',
	'name',
	'type',
	'charset',
	'disposition',
	'cid',
];

/** The `Email/get` properties of one message with its bodies. */
const MESSAGE_PROPERTIES: readonly string[] = [
	...SUMMARY_PROPERTIES,
	'bodyValues',
	'textBody',
	'htmlBody',
	'attachments',
];

/**
 * The most of one body part's text a message fetch for display returns (`maxBodyValueBytes`); a
 * message cut to it is marked `truncated`. Drafts are the exception: one cut short is fetched again
 * whole, since editing saves it back. So is a message read `whole`, to quote.
 */
export const MAX_BODY_VALUE_BYTES = 2 * 1024 * 1024;

/** True when the server cut one of the email's body values short (`isTruncated`). */
function isCut(email: JmapObject): boolean {
	const values = isRecord(email.bodyValues) ? Object.values(email.bodyValues) : [];
	return values.some((value) => isRecord(value) && value.isTruncated === true);
}

/** A PatchObject for an `EmailPatch` (`keywords/$seen: true | null`, `mailboxIds/<id>: ...`). */
export function emailPatch(patch: EmailPatch): Record<string, true | null> {
	const out: Record<string, true | null> = {};
	for (const [keyword, on] of Object.entries(patch.keywords ?? {}))
		out[patchPath('keywords', keyword)] = on ? true : null;
	for (const [mailboxId, on] of Object.entries(patch.mailboxIds ?? {}))
		out[patchPath('mailboxIds', mailboxId)] = on ? true : null;
	return out;
}

export interface EmailMethods {
	query(query: MailQuery, page?: MailQueryPage): Promise<MailQueryResult>;
	summaries(ids: readonly string[]): Promise<EmailSummary[]>;
	message(id: string, options?: MessageReadOptions): Promise<MailMessage>;
	update(patches: Readonly<Record<string, EmailPatch>>): Promise<void>;
	destroy(ids: readonly string[]): Promise<void>;
}

export function createEmailMethods(
	client: JmapClient,
	tracker: ChangeTracker,
	nudge: () => void,
): EmailMethods {
	return {
		async query(query, page = {}) {
			const filter = toJmapFilter(query);
			const position = page.position ?? 0;
			const { result, calls } = await client.request((builder, accountId) =>
				builder.call('Email/query', {
					accountId,
					filter: filter ?? undefined,
					sort: [{ property: 'receivedAt', isAscending: false }],
					position,
					limit: page.limit,
					calculateTotal: true,
					collapseThreads: false,
				}),
			);
			const args = result.get(calls);
			const ids = strings(args.ids);
			const at = typeof args.position === 'number' ? args.position : position;
			return {
				ids,
				total: typeof args.total === 'number' ? args.total : at + ids.length,
				position: at,
			};
		},

		async summaries(ids) {
			const found = new Map<string, EmailSummary>();
			await client.batch(
				[...new Set(ids)],
				(limits) => limits.maxObjectsInGet,
				(builder, accountId, chunk) =>
					builder.call('Email/get', { accountId, ids: chunk, properties: SUMMARY_PROPERTIES }),
				(result, call) => {
					const args = result.get(call);
					tracker.observe('Email', args.state);
					for (const email of objects(args.list)) found.set(email.id, toSummary(email));
				},
			);
			return ids.flatMap((id) => {
				const summary = found.get(id);
				return summary ? [summary] : [];
			});
		},

		async message(id, options = {}) {
			/** The email with its bodies, each value cut to `maxBodyValueBytes` when one is given. */
			const read = async (maxBodyValueBytes?: number): Promise<JmapObject> => {
				const { result, calls } = await client.request((builder, accountId) =>
					builder.call('Email/get', {
						accountId,
						ids: [id],
						properties: MESSAGE_PROPERTIES,
						bodyProperties: BODY_PROPERTIES,
						fetchTextBodyValues: true,
						fetchHTMLBodyValues: true,
						maxBodyValueBytes,
					}),
				);
				const args = result.get(calls);
				tracker.observe('Email', args.state);
				const email = objects(args.list).find((item) => item.id === id);
				if (!email) throw new MailTransportError('notFound', 'The message no longer exists.');
				return email;
			};
			/** Every value in full (no limit), or not at all: never a prefix to quote or save back. */
			const whole = async (): Promise<MailMessage> => {
				const email = await read();
				if (isCut(email))
					throw new MailTransportError('tooLarge', 'The server would only send part of it.');
				return toMessage(email);
			};
			if (options.whole) return whole();
			const email = await read(MAX_BODY_VALUE_BYTES);
			const message = toMessage(email);
			if (!isCut(email)) return message;
			// Editing a draft saves it in place of itself, so a cut body would replace the whole one.
			return message.keywords[DRAFT] ? whole() : { ...message, truncated: true };
		},

		async update(patches) {
			const entries = Object.entries(patches)
				.map(([id, patch]) => [id, emailPatch(patch)] as const)
				.filter(([, patch]) => Object.keys(patch).length > 0);
			const updated: string[] = [];
			let failure: unknown;
			try {
				await client.batch(
					entries,
					(limits) => limits.maxObjectsInSet,
					(builder, accountId, chunk) =>
						builder.call('Email/set', { accountId, update: Object.fromEntries(chunk) }),
					// Each message is changed on its own (RFC 8620 5.3): one refused, the rest still go.
					(result, call) => {
						try {
							const args = result.get(call);
							if (isRecord(args.updated)) updated.push(...Object.keys(args.updated));
							result.set(call);
						} catch (error) {
							failure ??= error;
						}
					},
				);
			} catch (error) {
				// A request that failed: what it held is not known to have changed, and the rest is not sent.
				failure ??= error;
			} finally {
				if (entries.length) nudge();
			}
			if (failure !== undefined)
				throw updated.length ? new PartialUpdateError(updated, failure) : failure;
		},

		async destroy(ids) {
			const unique = [...new Set(ids)];
			try {
				await client.batch(
					unique,
					(limits) => limits.maxObjectsInSet,
					(builder, accountId, chunk) => builder.call('Email/set', { accountId, destroy: chunk }),
					// Already gone is what was asked for.
					(result, call) => void result.set(call, (type) => type === 'notFound'),
				);
			} finally {
				if (unique.length) nudge();
			}
		},
	};
}
