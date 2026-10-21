import { errorText, noticeText } from './app-text';
import { MAIL_LOCALES, mailI18n } from './i18n/translator';

describe('the words of an error notice', () => {
	it('says that a change the browser could not store lasts until the page is closed', () => {
		const notice = { kind: 'error', action: 'contacts', code: 'storage' } as const;
		expect(noticeText(notice, mailI18n('en'))).toBe(
			'Your browser could not store this change. It is kept only until you close the page.',
		);
		for (const locale of MAIL_LOCALES)
			expect(errorText('storage', mailI18n(locale)), locale).not.toBe('error.storage');
	});
});
