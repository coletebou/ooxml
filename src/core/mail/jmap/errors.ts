// Failures of the JMAP client as `MailTransportError`s: HTTP statuses, request-level problem details
// (RFC 8620 3.6.1), method-level errors (3.6.2) and per-record SetErrors (RFC 8620 5.3, RFC 8621),
// each with the `MailErrorCode` the UI words. Server text is scrubbed of the credentials and cut
// short; a credential never reaches a message, a cause or a detail. New code.
import { MailTransportError, type MailErrorCode } from '../transport';
import { isRecord } from './types';

/** Where a failure came from: HTTP, a request-level problem, a method error or a SetError. */
export type JmapErrorLevel = 'http' | 'request' | 'method' | 'set';

export interface JmapErrorInit {
	level: JmapErrorLevel;
	/** The problem-details type, method error type or SetError type; '' for a plain HTTP failure. */
	type?: string;
	status?: number;
	/** The id or creation id a SetError is about. */
	target?: string;
	/** Type-specific extras the server sent (`limit`, `properties`, `existingId`, `description`). */
	details?: Readonly<Record<string, unknown>>;
	cause?: unknown;
}

/** A JMAP failure. `code` is what the UI words; `type` keeps the server's own error type. */
export class JmapError extends MailTransportError {
	readonly level: JmapErrorLevel;
	readonly type: string;
	readonly status: number | null;
	readonly target: string | null;
	readonly details: Readonly<Record<string, unknown>>;
	constructor(code: MailErrorCode, message: string, init: JmapErrorInit) {
		super(code, message, init.cause === undefined ? undefined : { cause: init.cause });
		this.name = 'JmapError';
		this.level = init.level;
		this.type = init.type ?? '';
		this.status = init.status ?? null;
		this.target = init.target ?? null;
		this.details = init.details ?? {};
	}
}

/** Removes every credential from text that came from a server or a platform error. */
export type Redact = (text: string) => string;

export function createRedactor(secrets: readonly string[]): Redact {
	const list = secrets.filter((secret) => secret.length > 0).sort((a, b) => b.length - a.length);
	return (text) => list.reduce((out, secret) => out.split(secret).join('[redacted]'), text);
}

const MAX_TEXT = 300;

/** Server-supplied text for a message: scrubbed, white space collapsed, cut to 300 characters. */
export function serverText(value: unknown, redact: Redact): string {
	if (typeof value !== 'string') return '';
	const text = redact(value).replace(/\s+/g, ' ').trim();
	return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}\u2026` : text;
}

/** A scrubbed copy of `error` (and of its causes), safe to attach as a cause. */
export function safeCause(error: unknown, redact: Redact, depth = 0): Error {
	const source = error instanceof Error ? error : new Error(String(error));
	const nested =
		depth < 3 && source.cause !== undefined
			? safeCause(source.cause, redact, depth + 1)
			: undefined;
	const copy = new Error(redact(source.message), nested ? { cause: nested } : undefined);
	copy.name = source.name;
	if (source.stack !== undefined) copy.stack = redact(source.stack);
	return copy;
}

function scrub(value: unknown, redact: Redact): unknown {
	if (typeof value === 'string') return redact(value);
	if (typeof value === 'number' || typeof value === 'boolean') return value;
	if (Array.isArray(value)) return value.map((item) => scrub(item, redact));
	return undefined;
}

/** HTTP status to error code: 401, 403, 404, 413, 429 and 5xx have their own. */
export function httpCode(status: number): MailErrorCode {
	if (status === 401) return 'unauthorized';
	if (status === 403) return 'forbidden';
	if (status === 404) return 'notFound';
	if (status === 413) return 'tooLarge';
	if (status === 429) return 'rateLimited';
	if (status >= 500) return 'server';
	return status >= 400 ? 'invalid' : 'server';
}

const PROBLEM = 'urn:ietf:params:jmap:error:';

function problemCode(type: string, limit: string | undefined): MailErrorCode | undefined {
	if (type === `${PROBLEM}unknownCapability`) return 'unsupported';
	if (type === `${PROBLEM}notJSON` || type === `${PROBLEM}notRequest`) return 'invalid';
	if (type !== `${PROBLEM}limit`) return undefined;
	return limit === 'maxConcurrentRequests' || limit === 'maxConcurrentUpload'
		? 'rateLimited'
		: 'tooLarge';
}

/** A failed HTTP response as a `JmapError`, read from its problem details when it has them. */
export async function responseError(
	response: Response,
	what: string,
	redact: Redact,
): Promise<JmapError> {
	const { status } = response;
	let problem: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(await response.text());
		if (isRecord(parsed)) problem = parsed;
	} catch {
		// Not a problem-details body: the status says enough.
	}
	const type = serverText(problem.type, redact);
	const limit = serverText(problem.limit, redact) || undefined;
	const detail = serverText(problem.detail ?? problem.title, redact);
	const code = problemCode(type, limit) ?? httpCode(status);
	const named = type ? ` (${type.startsWith(PROBLEM) ? type.slice(PROBLEM.length) : type})` : '';
	return new JmapError(
		code,
		`${what} failed with HTTP ${status}${named}${detail ? `: ${detail}` : '.'}`,
		{
			level: type.startsWith(PROBLEM) ? 'request' : 'http',
			type,
			status,
			details: { ...(limit ? { limit } : {}), ...(detail ? { detail } : {}) },
		},
	);
}

/** A `fetch` that rejected: the server could not be reached. */
export function networkError(what: string, error: unknown, redact: Redact): JmapError {
	return new JmapError('network', `${what} could not reach the JMAP server.`, {
		level: 'http',
		cause: safeCause(error, redact),
	});
}

const METHOD_CODES = new Map<string, MailErrorCode>([
	['serverUnavailable', 'server'],
	['serverFail', 'server'],
	['serverPartialFail', 'server'],
	['unknownMethod', 'unsupported'],
	['invalidArguments', 'invalid'],
	['invalidResultReference', 'invalid'],
	['forbidden', 'forbidden'],
	['accountNotFound', 'notFound'],
	['accountNotSupportedByMethod', 'unsupported'],
	['accountReadOnly', 'forbidden'],
	['requestTooLarge', 'tooLarge'],
	['cannotCalculateChanges', 'server'],
	['stateMismatch', 'invalid'],
	['anchorNotFound', 'notFound'],
	['unsupportedSort', 'unsupported'],
	['unsupportedFilter', 'unsupported'],
	['fromAccountNotFound', 'notFound'],
	['tooLarge', 'tooLarge'],
	['overQuota', 'overQuota'],
	['rateLimit', 'rateLimited'],
]);

/** A method-level `error` response (RFC 8620 3.6.2); unknown types count as `serverFail`. */
export function methodError(method: string, args: unknown, redact: Redact): JmapError {
	const record = isRecord(args) ? args : {};
	const type = serverText(record.type, redact) || 'serverFail';
	const description = serverText(record.description, redact);
	return new JmapError(
		METHOD_CODES.get(type) ?? 'server',
		`${method} failed: ${type}${description ? ` (${description})` : ''}.`,
		{ level: 'method', type, details: description ? { description } : {} },
	);
}

const SET_CODES = new Map<string, MailErrorCode>([
	['forbidden', 'forbidden'],
	['overQuota', 'overQuota'],
	['tooLarge', 'tooLarge'],
	['rateLimit', 'rateLimited'],
	['notFound', 'notFound'],
	['invalidPatch', 'invalid'],
	['willDestroy', 'invalid'],
	['invalidProperties', 'invalid'],
	['singleton', 'forbidden'],
	['alreadyExists', 'invalid'],
	['mailboxHasChild', 'invalid'],
	['mailboxHasEmail', 'invalid'],
	['blobNotFound', 'notFound'],
	['tooManyKeywords', 'invalid'],
	['tooManyMailboxes', 'invalid'],
	['invalidEmail', 'invalid'],
	['tooManyRecipients', 'invalid'],
	['noRecipients', 'invalid'],
	['invalidRecipients', 'invalid'],
	['forbiddenMailFrom', 'forbidden'],
	['forbiddenFrom', 'forbidden'],
	['forbiddenToSend', 'forbidden'],
	['cannotUnsend', 'forbidden'],
]);

const SET_DETAILS = [
	'properties',
	'notFound',
	'existingId',
	'maxRecipients',
	'invalidRecipients',
	'maxSize',
] as const;

/** A SetError (RFC 8620 5.3, RFC 8621 4.6, 7.5) about record `target` of `method`. */
export function setError(
	method: string,
	target: string,
	error: unknown,
	redact: Redact,
): JmapError {
	const record = isRecord(error) ? error : {};
	const type = serverText(record.type, redact) || 'serverFail';
	const description = serverText(record.description, redact);
	const details: Record<string, unknown> = {};
	for (const key of SET_DETAILS) {
		const value = scrub(record[key], redact);
		if (value !== undefined) details[key] = value;
	}
	if (description) details.description = description;
	return new JmapError(
		SET_CODES.get(type) ?? 'server',
		`${method} rejected ${target}: ${type}${description ? ` (${description})` : ''}.`,
		{ level: 'set', type, target, details },
	);
}
