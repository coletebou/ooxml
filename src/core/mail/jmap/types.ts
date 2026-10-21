// JMAP wire shapes (RFC 8620 core, RFC 8621 mail) as a server sends them. Everything a response may
// omit or null is optional here: the server is untrusted, so `convert.ts` checks each value before
// it reaches the `mail` model. New code.

export const CORE = 'urn:ietf:params:jmap:core';
export const MAIL = 'urn:ietf:params:jmap:mail';
export const SUBMISSION = 'urn:ietf:params:jmap:submission';

/** A method call or response: name, arguments and method call id (RFC 8620 3.2). */
export type JmapInvocation = [name: string, args: Record<string, unknown>, callId: string];

/** The Request object (RFC 8620 3.3). */
export interface JmapRequest {
	using: string[];
	methodCalls: JmapInvocation[];
	createdIds?: Record<string, string>;
}

/** The Response object (RFC 8620 3.4). */
export interface JmapResponse {
	methodResponses: JmapInvocation[];
	createdIds?: Record<string, string>;
	sessionState: string;
}

/** `EmailAddress` (RFC 8621 4.1.2.3). */
export interface JmapEmailAddress {
	name?: string | null;
	email?: string | null;
}

/** `Mailbox` (RFC 8621 2). */
export interface JmapMailbox {
	id: string;
	name?: string;
	parentId?: string | null;
	role?: string | null;
	sortOrder?: number;
	totalEmails?: number;
	unreadEmails?: number;
}

/** `EmailBodyPart` (RFC 8621 4.1.4), with the properties this client asks for. */
export interface JmapEmailBodyPart {
	partId?: string | null;
	blobId?: string | null;
	size?: number;
	name?: string | null;
	type?: string;
	charset?: string | null;
	disposition?: string | null;
	cid?: string | null;
}

/** `EmailBodyValue` (RFC 8621 4.1.4). */
export interface JmapEmailBodyValue {
	value?: string;
	isEncodingProblem?: boolean;
	isTruncated?: boolean;
}

/** `Email` (RFC 8621 4.1), the metadata, convenience header and body properties. */
export interface JmapEmail {
	id: string;
	blobId?: string;
	threadId?: string;
	mailboxIds?: Record<string, boolean>;
	keywords?: Record<string, boolean>;
	size?: number;
	receivedAt?: string;
	messageId?: string[] | null;
	inReplyTo?: string[] | null;
	references?: string[] | null;
	from?: JmapEmailAddress[] | null;
	to?: JmapEmailAddress[] | null;
	cc?: JmapEmailAddress[] | null;
	bcc?: JmapEmailAddress[] | null;
	replyTo?: JmapEmailAddress[] | null;
	subject?: string | null;
	sentAt?: string | null;
	hasAttachment?: boolean;
	preview?: string;
	bodyValues?: Record<string, JmapEmailBodyValue>;
	textBody?: JmapEmailBodyPart[];
	htmlBody?: JmapEmailBodyPart[];
	attachments?: JmapEmailBodyPart[];
}

/** `Identity` (RFC 8621 6). */
export interface JmapIdentity {
	id: string;
	name?: string;
	email?: string;
	replyTo?: JmapEmailAddress[] | null;
	bcc?: JmapEmailAddress[] | null;
	textSignature?: string;
	htmlSignature?: string;
}

/** `SetError` (RFC 8620 5.3): a type, a debugging description and type-specific extras. */
export interface JmapSetError {
	type: string;
	description?: string | null;
	[extra: string]: unknown;
}

/** A push `StateChange` (RFC 8620 7.1): new state strings per account and type. */
export interface JmapStateChange {
	'@type': 'StateChange';
	changed: Record<string, Record<string, string>>;
}

/** True for a plain JSON object (not an array or `null`). */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
