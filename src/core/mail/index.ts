// `ooxml-core/mail`: the logic of a mail, calendar and contacts application that works directly with
// standard JMAP servers (RFC 8620, RFC 8621) or an in-memory transport: the message model, MIME and
// `.eml`, RFC 5256 threading, search, compose rules, vCard contacts, the client store every UI binds
// to, and the pluggable transport seam. No DOM, no UI framework. See docs/mail-area.md.
export * from './calendar-store';
export * from './client';
export type * from './client-types';
export { ENGLISH_QUOTE_FORMAT } from './client-compose';
export * from './client-views';
export * from './compose';
export * from './contacts';
export * from './demo-seed';
export * from './eml';
// The JMAP client: the transport, plus the lower layers a host needs to call methods this area does
// not wrap (the request builder, session discovery). The rest of `./jmap` is internal.
export {
	DEFAULT_POLL_INTERVAL_MS,
	JmapError,
	JmapRequestBuilder,
	JmapResult,
	createJmapClient,
	createJmapTransport,
	discoverJmapSession,
	mailAccountId,
	parseJmapSession,
	toJmapFilter,
	type JmapAuth,
	type JmapCall,
	type JmapClient,
	type JmapClientOptions,
	type JmapErrorLevel,
	type JmapFilter,
	type JmapLimits,
	type JmapSession,
	type JmapSessionAccount,
	type JmapTransportOptions,
	type PushMode,
} from './jmap';
export { DEFAULT_MAILBOXES, type SeedMailbox, type SeedMessage } from './memory-messages';
export * from './memory-transport';
export * from './mime';
export * from './model';
export * from './record-store';
export * from './search';
export * from './subject';
export * from './threading';
export * from './transport';
export * from './vcard';
