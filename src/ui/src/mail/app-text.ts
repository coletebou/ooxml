// The words <mail-app> puts around the client: notices (what just happened, in the person's
// language), error codes as sentences, and the localised quote wording replies and forwards use.
import {
	formatAddress,
	type ComposeState,
	type MailErrorCode,
	type MailMessage,
	type MailNotice,
	type QuoteFormat,
} from 'ooxml-core/mail';
import { fullDate } from './format';
import type { MailI18n, MailKey } from './i18n/translator';

const ERRORS: Record<MailErrorCode, MailKey> = {
	unauthorized: 'error.unauthorized',
	forbidden: 'error.forbidden',
	network: 'error.network',
	notFound: 'error.notFound',
	invalid: 'error.invalid',
	overQuota: 'error.overQuota',
	tooLarge: 'error.tooLarge',
	rateLimited: 'error.rateLimited',
	unsupported: 'error.unsupported',
	server: 'error.server',
	uncertain: 'error.uncertain',
	storage: 'error.storage',
};

/** A transport error code as a sentence. */
export function errorText(code: MailErrorCode, i18n: MailI18n): string {
	return i18n.t(ERRORS[code]);
}

/** What a notice says. */
export function noticeText(notice: MailNotice, i18n: MailI18n): string {
	if (notice.kind === 'error') return errorText(notice.code, i18n);
	if (notice.kind === 'warning') {
		if (notice.action === 'upload') return i18n.tn('notice.stillUploading', notice.uploading);
		if (notice.action === 'readFiles')
			return i18n.tn('notice.unreadable', notice.names.length, {
				names: new Intl.ListFormat(i18n.intl, { type: 'conjunction' }).format(notice.names),
			});
		return notice.action === 'contactsImported'
			? i18n.tn('notice.contactsSkipped', notice.skipped)
			: i18n.tn('notice.eventsUnsupported', notice.unsupported.length);
	}
	switch (notice.action) {
		case 'sent':
			return i18n.t('notice.sent');
		case 'saved':
			return i18n.t('notice.saved');
		case 'moved':
			return i18n.tn('notice.moved', notice.count, { folder: notice.target ?? '' });
		case 'archived':
			return i18n.tn('notice.archived', notice.count);
		case 'junk':
			return i18n.tn('notice.junk', notice.count);
		case 'deleted':
			return i18n.tn('notice.deleted', notice.count);
		case 'discarded':
			return i18n.t('notice.discarded');
		case 'imported':
			return i18n.tn('notice.imported', notice.count);
		case 'contactsImported':
			return i18n.tn('notice.contactsImported', notice.count);
		case 'eventsImported':
			return i18n.tn('notice.eventsImported', notice.count);
		case 'undone':
			return i18n.t('notice.undone');
	}
}

/** What the compose window's footer says about its draft. */
export function composeStatus(compose: ComposeState, i18n: MailI18n): string {
	if (compose.uploading) return i18n.tn('compose.uploading', compose.uploading);
	switch (compose.status) {
		case 'saving':
			return i18n.t('compose.saving');
		case 'sending':
			return i18n.t('compose.sending');
		case 'saved':
			return compose.savedAt
				? i18n.t('compose.savedAt', {
						time: new Date(compose.savedAt).toLocaleTimeString(i18n.intl, {
							hour: 'numeric',
							minute: '2-digit',
						}),
					})
				: i18n.t('compose.savedDraft');
		case 'error':
			return compose.error === 'invalid'
				? i18n.t('compose.checkRecipients')
				: errorText(compose.error ?? 'server', i18n);
		default:
			return '';
	}
}

/** The wording around quoted replies and forwards, in the display locale. */
export function quoteFormat(i18n: () => MailI18n): QuoteFormat {
	const when = (source: MailMessage): string =>
		fullDate(source.sentAt ?? source.receivedAt, i18n());
	return {
		attribution: (source) =>
			i18n().t('compose.attribution', {
				date: when(source),
				sender: source.from[0] ? formatAddress(source.from[0]) : i18n().t('list.noSender'),
			}),
		forwardHeader: (source) => {
			const t = i18n().t;
			return [
				t('compose.forwardedHeader'),
				t('compose.forwardFrom', { value: source.from.map(formatAddress).join(', ') }),
				t('compose.forwardDate', { value: when(source) }),
				t('compose.forwardSubject', { value: source.subject }),
				t('compose.forwardTo', { value: source.to.map(formatAddress).join(', ') }),
				...(source.cc.length
					? [t('compose.forwardCc', { value: source.cc.map(formatAddress).join(', ') })]
					: []),
			];
		},
	};
}
