// A `MailQuery` as an `Email/query` filter (RFC 8621 4.4.1). Each word of a text field is a
// condition of its own and every condition must hold (`AND`), the way the memory transport's
// matcher reads a query; `to` also looks in Cc and Bcc, as that matcher does. New code.
import { FLAGGED, SEEN } from '../model';
import { MailTransportError, type MailQuery } from '../transport';

/** A FilterCondition: one property per condition here. */
export type JmapFilterCondition = Readonly<Record<string, unknown>>;

/** A FilterOperator (RFC 8620 5.5). */
export interface JmapFilterOperator {
	operator: 'AND' | 'OR' | 'NOT';
	conditions: readonly JmapFilter[];
}

export type JmapFilter = JmapFilterCondition | JmapFilterOperator;

/** A UTCDate (RFC 8620 1.4), `2014-10-30T06:12:00Z`: fractional seconds only when not zero. */
export function toUtcDate(ms: number): string {
	if (!Number.isFinite(ms))
		throw new MailTransportError('invalid', 'The search date is not a time.');
	return new Date(ms).toISOString().replace('.000Z', 'Z');
}

const words = (text: string | undefined): string[] => (text ?? '').split(/\s+/).filter(Boolean);

/** The `Email/query` filter for `query`, or `null` when it matches every message. */
export function toJmapFilter(query: MailQuery): JmapFilter | null {
	const conditions: JmapFilter[] = [];
	if (query.mailboxId !== undefined) conditions.push({ inMailbox: query.mailboxId });
	for (const word of words(query.text)) conditions.push({ text: word });
	for (const word of words(query.from)) conditions.push({ from: word });
	for (const word of words(query.to))
		conditions.push({ operator: 'OR', conditions: [{ to: word }, { cc: word }, { bcc: word }] });
	for (const word of words(query.subject)) conditions.push({ subject: word });
	for (const word of words(query.body)) conditions.push({ body: word });
	if (query.hasAttachment !== undefined) conditions.push({ hasAttachment: query.hasAttachment });
	if (query.unread !== undefined)
		conditions.push(query.unread ? { notKeyword: SEEN } : { hasKeyword: SEEN });
	if (query.flagged !== undefined)
		conditions.push(query.flagged ? { hasKeyword: FLAGGED } : { notKeyword: FLAGGED });
	if (query.before !== undefined) conditions.push({ before: toUtcDate(query.before) });
	if (query.after !== undefined) conditions.push({ after: toUtcDate(query.after) });
	if (conditions.length > 1) return { operator: 'AND', conditions };
	return conditions[0] ?? null;
}
