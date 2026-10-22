// The contract every framework binding implements: the same props in, the same events out. The
// bindings are lifecycle adapters only (create the element, forward props, re-emit events);
// behaviour lives in <mail-app>. Each binding also ships raw hooks over the core client, for apps
// that render their own UI (see `store.ts`).
import type { MailAccount, MailNotice } from 'ooxml-core/mail';
import type { MailApp, MailTheme, MailView, OpenAttachmentDetail } from './mail-app';
import type { MailConnection } from './store';

export interface MailProps {
	/** Where the mail comes from: the demo mailbox (default), a JMAP server or your own transport. */
	config?: MailConnection | null;
	/** Display language: a BCP 47 tag such as `de` or `zh-CN`. English, German, Spanish, French and Simplified Chinese ship; empty or unknown means English. */
	locale?: string;
	/** `system` (default) follows the page's colour scheme. */
	theme?: MailTheme;
	/** The view to show: `mail` (default), `calendar` or `contacts`. */
	view?: MailView;
	onReady?: (detail: { account: MailAccount | null }) => void;
	/** Every notice the app shows (sent, moved, errors), for hosts that log or announce them. */
	onNotice?: (notice: MailNotice) => void;
	/** Cancel the event (`preventDefault`) to open an attachment yourself instead of the preview. */
	onOpenAttachment?: (
		detail: OpenAttachmentDetail,
		event: CustomEvent<OpenAttachmentDetail>,
	) => void;
}

/**
 * Push props onto the element. Only changed values are written, so frameworks can call it freely,
 * and a view the person picked on the rail stays while the host passes the same `view` or none. A
 * prop taken away is its default again: no locale, the system theme, the mail view, the demo
 * mailbox.
 */
export function applyMailProps(el: MailApp, props: MailProps, prev: MailProps = {}): void {
	if (props.locale !== prev.locale) el.locale = props.locale ?? '';
	if (props.theme !== prev.theme) el.theme = props.theme ?? 'system';
	if (props.view !== prev.view) el.view = props.view ?? 'mail';
	if (props.config !== prev.config) el.config = props.config ?? null;
}

/** Subscribe to the element's events; the latest handlers are read through `get`. */
export function listenMailEvents(el: MailApp, get: () => MailProps): () => void {
	const ready = (e: Event): void => get().onReady?.((e as CustomEvent).detail);
	const notice = (e: Event): void => get().onNotice?.((e as CustomEvent<MailNotice>).detail);
	const open = (e: Event): void => {
		const ce = e as CustomEvent<OpenAttachmentDetail>;
		get().onOpenAttachment?.(ce.detail, ce);
	};
	el.addEventListener('mail-ready', ready);
	el.addEventListener('mail-notice', notice);
	el.addEventListener('mail-open-attachment', open);
	return () => {
		el.removeEventListener('mail-ready', ready);
		el.removeEventListener('mail-notice', notice);
		el.removeEventListener('mail-open-attachment', open);
	};
}
