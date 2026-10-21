// The MIME codec of the mail area: RFC 5322 messages and their MIME structure (RFC 2045, 2046,
// 2047, 2183, 2231, 6532), read into the shapes of RFC 8621 and written for sending or for `.eml`
// export. DOM-free. New code.
export {
	formatAddrSpec,
	formatAddressList,
	formatMailbox,
	formatMessageIds,
	parseAddressList,
	parseContentId,
	parseMessageIds,
} from './addresses';
export {
	writeEmail,
	type OutgoingAttachment,
	type OutgoingEmail,
	type WriteOptions,
} from './build';
export { decodeCharset, normalizeCharset } from './charset';
export { formatDate, parseDate } from './dates';
export { decodeEncodedWords, encodeHeaderText, encodePhrase } from './encoded-words';
export {
	foldHeader,
	getHeader,
	getHeaders,
	parseHeaders,
	splitMessage,
	type HeaderField,
	type MessageSplit,
} from './headers';
export { toMailMessage, type MailMessageMeta } from './message';
export {
	formatParameters,
	parseContentDisposition,
	parseContentType,
	type ContentDisposition,
	type ContentType,
} from './parameters';
export { readEmail, type ReadOptions } from './parse';
export { decodeQuotedPrintable, encodeQuotedPrintable } from './quoted-printable';
export { bodyStructure, isInlineMediaType, type BodyStructure } from './structure';
export type { MimePart, ParsedAttachment, ParsedEmail } from './types';
