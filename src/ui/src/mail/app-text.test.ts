import { errorText, noticeText } from './app-text';
import { MAIL_LOCALES, mailI18n } from './i18n/translator';

describe('the words of a warning', () => {
	it('names the files the browser could not read, in every locale', () => {
		const one = { kind: 'warning', action: 'readFiles', names: ['a.pdf'] } as const;
		const two = { kind: 'warning', action: 'readFiles', names: ['a.pdf', 'b.ics'] } as const;
		expect(noticeText(one, mailI18n('en'))).toBe('a.pdf could not be read.');
		expect(noticeText(two, mailI18n('en'))).toBe('2 files could not be read: a.pdf and b.ics.');
		for (const locale of MAIL_LOCALES) {
			expect(noticeText(one, mailI18n(locale)), locale).toContain('a.pdf');
			expect(noticeText(two, mailI18n(locale)), locale).toMatch(/2.*a\.pdf.*b\.ics/su);
		}
	});

	it('says how many cards of a vCard file it could not read, whole or in part, in every locale', () => {
		const notice = (skipped: number, partial: number) =>
			({ kind: 'warning', action: 'contactsImported', skipped, partial }) as const;
		const en = mailI18n('en');
		expect(noticeText(notice(2, 0), en)).toBe('2 cards in the file could not be read.');
		expect(noticeText(notice(0, 1), en)).toBe('Part of 1 card in the file could not be read.');
		expect(noticeText(notice(1, 3), en)).toBe(
			'1 card in the file could not be read. Part of 3 cards in the file could not be read.',
		);
		for (const locale of MAIL_LOCALES)
			expect(noticeText(notice(0, 3), mailI18n(locale)), locale).toContain('3');
	});
});

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
