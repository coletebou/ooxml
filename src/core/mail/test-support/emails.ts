// Builders for mail tests: an `EmailSummary` from just the fields a test cares about.
import type { EmailSummary, MailAddress } from '../model';

export interface EmailSpec {
	messageId?: string;
	references?: string[];
	inReplyTo?: string[];
	subject?: string;
	/** Minutes after a fixed epoch, so ordering is obvious in a test. */
	minute?: number;
	from?: MailAddress;
	to?: MailAddress[];
	mailboxIds?: string[];
	keywords?: Record<string, true>;
	preview?: string;
	hasAttachment?: boolean;
}

const EPOCH = Date.UTC(2026, 0, 5, 9, 0, 0);

export function summary(id: string, spec: EmailSpec = {}): EmailSummary {
	const at = EPOCH + (spec.minute ?? 0) * 60_000;
	return {
		id,
		threadId: id,
		blobId: `blob-${id}`,
		mailboxIds: spec.mailboxIds ?? ['inbox'],
		keywords: spec.keywords ?? {},
		receivedAt: at,
		sentAt: at,
		size: 1000,
		messageId:
			spec.messageId === undefined
				? [`${id}@example.test`]
				: spec.messageId
					? [spec.messageId]
					: [],
		inReplyTo: spec.inReplyTo ?? [],
		references: spec.references ?? [],
		from: [spec.from ?? { name: 'Ada', email: 'ada@example.test' }],
		to: spec.to ?? [{ name: 'Grace', email: 'grace@example.test' }],
		cc: [],
		bcc: [],
		replyTo: [],
		subject: spec.subject ?? `Subject ${id}`,
		preview: spec.preview ?? '',
		hasAttachment: spec.hasAttachment ?? false,
	};
}
