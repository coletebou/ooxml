// The JMAP client transport of `ooxml-core/mail` (RFC 8620 core, RFC 8621 mail), and the layers it
// is built from: session discovery, requests with result references, error mapping, filters,
// conversions to the mail model, server-sent events and push. New code.
export {
	DEFAULT_POLL_INTERVAL_MS,
	createJmapTransport,
	type JmapTransportOptions,
} from './transport';
export type { PushMode } from './watch';
export {
	authorization,
	createJmapHttp,
	isSafeUrl,
	type JmapAuth,
	type JmapHttp,
	type JmapHttpInit,
	type JmapHttpOptions,
} from './http';
export { expandTemplate, resolveTemplate, sessionResourceUrl } from './urls';
export {
	accountHas,
	discoverJmapSession,
	loadJmapSession,
	mailAccountId,
	parseJmapSession,
	type DiscoverJmapSessionOptions,
	type JmapLimits,
	type JmapSession,
	type JmapSessionAccount,
} from './session';
export {
	JmapRequestBuilder,
	JmapResult,
	JmapResultReference,
	parseJmapResponse,
	patchPath,
	setErrors,
	type JmapCall,
	type SetErrorKey,
} from './request';
export { chunk, createJmapClient, type JmapClient, type JmapClientOptions } from './client';
export {
	JmapError,
	httpCode,
	methodError,
	responseError,
	setError,
	type JmapErrorInit,
	type JmapErrorLevel,
} from './errors';
export {
	toJmapFilter,
	toUtcDate,
	type JmapFilter,
	type JmapFilterCondition,
	type JmapFilterOperator,
} from './filter';
export {
	fromJmapDate,
	objects,
	toAddresses,
	toAttachment,
	toIdentity,
	toJmapAddresses,
	toMailbox,
	toMailboxRole,
	toMessage,
	toSummary,
	type JmapObject,
} from './convert';
export { emailPatch, MAX_BODY_VALUE_BYTES, SUMMARY_PROPERTIES } from './emails';
export { emailToCreate, identityCovers, pickIdentity } from './outgoing';
export { createSseParser, type SseEvent, type SseHandlers, type SseParser } from './sse';
export { eventSourceUrl, startPush, stateChangeFor, type PushOptions, type Timers } from './push';
export {
	CORE,
	MAIL,
	SUBMISSION,
	isRecord,
	type JmapEmail,
	type JmapEmailAddress,
	type JmapEmailBodyPart,
	type JmapEmailBodyValue,
	type JmapIdentity,
	type JmapInvocation,
	type JmapMailbox,
	type JmapRequest,
	type JmapResponse,
	type JmapSetError,
	type JmapStateChange,
} from './types';
