// `ooxml-ui/mail`: the mail, calendar and contacts app as custom elements over `ooxml-core/mail`.
// `<mail-app>` is the whole app; its parts are elements of their own so a host can compose a
// different shell. Importing this entry touches no DOM; `registerMail()` defines the elements.
import { defineMailAttachmentPreview } from './attachment-preview';
import { defineMailCalendar } from './calendar-pane';
import { defineMailCompose } from './compose';
import { defineMailContacts } from './contacts-pane';
import { defineMailFolderPane } from './folder-pane';
import { defineMailHtmlFrame } from './html-frame';
import { defineMailApp } from './mail-app';
import { defineMailMessageList } from './message-list';
import { defineMailReadingPane } from './reading-pane';
import { defineMailRecipients } from './recipients';

export {
	MailApp,
	defineMailApp,
	type MailTheme,
	type MailView,
	type OpenAttachmentDetail,
} from './mail-app';
export { MailAttachmentPreview, defineMailAttachmentPreview } from './attachment-preview';
export { MailCalendar, defineMailCalendar } from './calendar-pane';
export { MailCompose, defineMailCompose } from './compose';
export { MailContacts, defineMailContacts } from './contacts-pane';
export { MailFolderPane, defineMailFolderPane, MAIL_DRAG_TYPE } from './folder-pane';
export { MailHtmlFrame, defineMailHtmlFrame } from './html-frame';
export { MailMessageList, defineMailMessageList } from './message-list';
export { MailReadingPane, defineMailReadingPane, type InlineUrls } from './reading-pane';
export { MailRecipients, defineMailRecipients } from './recipients';
export { applyMailProps, listenMailEvents, type MailProps } from './bind';
/** Close a client's compose window (saving the draft, retrying for a while), then destroy it. */
export { release as releaseMailClient } from './app-client';
export * from './store';
export { previewKind, type PreviewKind } from './attachments';
/** For a client made with `createMailClient`: quotes and reopened drafts keep every HTML part. */
export { draftHtml } from './compose-editor';
export {
	commandFor,
	controlOwnsKey,
	isTyping,
	SHORTCUTS,
	type KeyLike,
	type MailCommand,
} from './keyboard';
export {
	emailDocument,
	linkify,
	sanitizeEmailHtml,
	sanitizeMessageHtml,
	type MessageHtml,
	type SanitizedHtml,
	type SanitizeOptions,
} from './sanitize';
export {
	MAIL_LOCALES,
	MAIL_MESSAGES,
	mailI18n,
	normalizeMailLocale,
	type MailI18n,
	type MailKey,
} from './i18n/translator';

/** Every tag `registerMail()` defines (attachment previews define theirs when first opened). */
export const MAIL_TAGS = [
	'mail-app',
	'mail-folder-pane',
	'mail-message-list',
	'mail-reading-pane',
	'mail-html-frame',
	'mail-compose',
	'mail-recipients',
	'mail-attachment-preview',
	'mail-calendar',
	'mail-calendar-grid',
	'mail-contacts',
] as const;

/** Define the mail elements. Idempotent; a no-op without a DOM. */
export function registerMail(): void {
	defineMailApp();
	defineMailFolderPane();
	defineMailMessageList();
	defineMailReadingPane();
	defineMailHtmlFrame();
	defineMailCompose();
	defineMailRecipients();
	defineMailAttachmentPreview();
	defineMailCalendar();
	defineMailContacts();
}
