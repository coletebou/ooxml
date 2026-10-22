import { missingMessageKeys } from 'ooxml-core/i18n';
import { MAIL_LOCALES, MAIL_MESSAGES, mailI18n, normalizeMailLocale } from './translator';

const PLACEHOLDER = /\{(\w+)\}/gu;
const placeholders = (text: string): string[] =>
	[...text.matchAll(PLACEHOLDER)].map((m) => m[1]!).sort();

const english = MAIL_MESSAGES.en;
const others = MAIL_LOCALES.filter((locale) => locale !== 'en');

describe('Mail dictionaries', () => {
	it('ships English plus de, es, fr and zh-CN', () => {
		expect([...MAIL_LOCALES].sort()).toEqual(['de', 'en', 'es', 'fr', 'zh-CN']);
	});

	it.each(others)('%s defines every English key and nothing else', (locale) => {
		const dictionary = MAIL_MESSAGES[locale];
		expect(missingMessageKeys(english, dictionary)).toEqual([]);
		expect(missingMessageKeys(dictionary, english)).toEqual([]);
	});

	it.each(others)('%s keeps the placeholders of every English message', (locale) => {
		const dictionary = MAIL_MESSAGES[locale];
		const mismatched = Object.keys(english).filter(
			(key) =>
				placeholders(dictionary[key] ?? '').join() !== placeholders(english[key] ?? '').join(),
		);
		expect(mismatched).toEqual([]);
	});

	it.each(MAIL_LOCALES)('%s has no empty text, no em-dash and no stray markup', (locale) => {
		for (const [key, text] of Object.entries(MAIL_MESSAGES[locale])) {
			expect(text.trim(), key).not.toBe('');
			expect(text, key).not.toContain(String.fromCharCode(0x2014));
			expect(text, key).not.toMatch(/[<>]/u);
		}
	});

	it('names no other mail program in its wording', () => {
		for (const locale of MAIL_LOCALES)
			for (const [key, text] of Object.entries(MAIL_MESSAGES[locale]))
				expect(text, `${locale} ${key}`).not.toMatch(/outlook|gmail|thunderbird|microsoft/iu);
	});

	it('gives every plural message a one and an other form', () => {
		const names = new Set(
			Object.keys(english)
				.filter((key) => key.endsWith('.other'))
				.map((key) => key.slice(0, -'.other'.length)),
		);
		expect(names.size).toBeGreaterThan(5);
		for (const name of names) expect(english[`${name}.one`], name).toBeDefined();
	});

	it('actually translates: no other locale repeats the English wording wholesale', () => {
		for (const locale of others) {
			const same = Object.keys(english).filter(
				(key) => MAIL_MESSAGES[locale][key] === english[key],
			);
			// Single words, units and placeholder-only messages may match; sentences may not.
			const sentences = same.filter(
				(key) => /\s/u.test(english[key] ?? '') && !/[\d{]/u.test(english[key] ?? ''),
			);
			expect(sentences, locale).toEqual([]);
		}
	});
});

describe('mailI18n', () => {
	it('maps region and script tags to the shipped locales, else English', () => {
		expect(normalizeMailLocale('de-AT')).toBe('de');
		expect(normalizeMailLocale('zh-Hans')).toBe('zh-CN');
		expect(normalizeMailLocale('xx')).toBe('en');
	});

	it('fills placeholders, picks plural forms and falls back to the key', () => {
		expect(mailI18n('en').tn('list.messages', 1)).toBe('1 message');
		expect(mailI18n('en').tn('list.messages', 3)).toBe('3 messages');
		expect(mailI18n('de').tn('list.messages', 3)).toBe('3 Nachrichten');
		expect(mailI18n('fr').t('folder.rename', { name: 'Projets' })).toBe('Renommer Projets');
		expect(mailI18n('de').t('no.such.key' as never)).toBe('no.such.key');
	});
});
