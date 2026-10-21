// What the answers to a send say about whether its message went out (RFC 8621 7.5): certainly not,
// when the server refused the submission or the request as a whole, or not known, which a send
// reports as `uncertain`; and, asked later, the copy a send whose answer never came made, found by
// its Message-ID, and whether a copy whose submission was not certain went out (7.3). `drafts.ts`
// decides with these what becomes of the copy a send made. New code.
import { DRAFT } from '../model';
import { MailTransportError } from '../transport';
import type { JmapClient } from './client';
import { objects, strings } from './convert';
import { JmapError } from './errors';
import type { JmapCall, JmapResult } from './request';
import { isRecord } from './types';

/**
 * True when the server certainly did not create `creationId` in `call`: it refused it (a SetError
 * in `notCreated`), or the method failed, which changes nothing unless the error is
 * `serverPartialFail` (RFC 8620 3.6.2). That error, or no answer, may mean the message went out.
 */
export function refused(result: JmapResult, call: JmapCall, creationId: string): boolean {
	const error = result.error(call);
	if (error) return error.type !== 'serverPartialFail';
	const notCreated = result.all(call).find((response) => response[0] === call.name)?.[1].notCreated;
	return isRecord(notCreated) && Object.hasOwn(notCreated, creationId);
}

/**
 * True when the server answered a request without processing any of it: with an HTTP client error
 * (4xx), the request as a whole is rejected (RFC 8620 3.6, the problem types of 3.6.1). No answer
 * (the network, an abort), a server error (5xx) or an answer that cannot be read leaves open what
 * the server did.
 */
export function unprocessed(error: unknown): boolean {
	const status = error instanceof JmapError ? error.status : null;
	return status !== null && status >= 400 && status < 500;
}

/**
 * A send that may have gone out, told as such: reported as not sent, it would be edited and sent
 * again, a second message. `cause` is what the server answered, or how the request failed.
 */
export const uncertain = (cause: unknown): MailTransportError =>
	new MailTransportError('uncertain', 'The server did not say whether the message was sent.', {
		cause,
	});

/**
 * The copy a send gave the Message-ID `messageId`, found by searching for it (the `header`
 * condition, RFC 8621 4.4.1): of several (the message delivered back to the account too), the one
 * in one of `boxes`, Drafts and Sent, where the send put it. Null when the server holds none,
 * or cannot search by header field (`unsupportedFilter`, RFC 8620 5.5), so it can never say. When
 * it cannot be asked (a request or a call fails), this throws: it may say later.
 */
export async function copyWithId(
	client: JmapClient,
	messageId: string,
	boxes: readonly string[],
): Promise<string | null> {
	const query = await client.request((builder, accountId) =>
		builder.call('Email/query', { accountId, filter: { header: ['Message-ID', messageId] } }),
	);
	if (query.result.error(query.calls)?.type === 'unsupportedFilter') return null;
	const ids = strings(query.result.get(query.calls).ids);
	if (ids.length < 2) return ids[0] ?? null;
	const get = await client.request((builder, accountId) =>
		builder.call('Email/get', { accountId, ids, properties: ['mailboxIds'] }),
	);
	const own = objects(get.result.get(get.calls).list).find((email) => {
		const kept = email.mailboxIds;
		return isRecord(kept) && boxes.some((id) => kept[id] === true);
	});
	return own?.id ?? ids[0] ?? null;
}

/**
 * Whether a copy whose submission was not certain went out: the server holds a submission of it
 * (RFC 8621 7.3), or it is no longer a draft, which only its submission makes it (a server may
 * drop the record of a submission, 7.5). Null when the server has neither a submission of it nor
 * the copy any more, so it can never say. When it cannot be asked (a request or a call fails),
 * this throws: it may say later.
 */
export async function wentOut(client: JmapClient, emailId: string): Promise<boolean | null> {
	const query = await client.request((builder, accountId) =>
		builder.call('EmailSubmission/query', { accountId, filter: { emailIds: [emailId] } }),
	);
	const ids = query.result.get(query.calls).ids;
	if (Array.isArray(ids) && ids.length) return true;
	const get = await client.request((builder, accountId) =>
		builder.call('Email/get', { accountId, ids: [emailId], properties: ['keywords'] }),
	);
	const list = get.result.get(get.calls).list;
	const copy: unknown = Array.isArray(list) ? list[0] : undefined;
	if (!isRecord(copy)) return null;
	return !(isRecord(copy.keywords) && copy.keywords[DRAFT] === true);
}
