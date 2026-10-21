import { missingMessageKeys } from 'ooxml-core/i18n';
import {
	NOTEBOOK_LOCALES,
	NOTEBOOK_MESSAGES,
	formatSize,
	normalizeNotebookLocale,
	notebookI18n,
} from './translator';

const PLACEHOLDER = /\{(\w+)\}/gu;
const placeholders = (text: string): string[] =>
	[...text.matchAll(PLACEHOLDER)].map((m) => m[1]!).sort();
const english = NOTEBOOK_MESSAGES.en;
const others = NOTEBOOK_LOCALES.filter((locale) => locale !== 'en');

describe('notebook dictionaries', () => {
	it('ships English plus de, es, fr and zh-CN', () => {
		expect([...NOTEBOOK_LOCALES].sort()).toEqual(['de', 'en', 'es', 'fr', 'zh-CN']);
	});

	it.each(others)('%s defines every English key and nothing else', (locale) => {
		expect(missingMessageKeys(english, NOTEBOOK_MESSAGES[locale])).toEqual([]);
		expect(missingMessageKeys(NOTEBOOK_MESSAGES[locale], english)).toEqual([]);
	});

	it.each(others)('%s keeps the placeholders of every English message', (locale) => {
		const dictionary = NOTEBOOK_MESSAGES[locale];
		const mismatched = Object.keys(english).filter(
			(key) =>
				placeholders(dictionary[key] ?? '').join() !== placeholders(english[key] ?? '').join(),
		);
		expect(mismatched).toEqual([]);
	});

	it.each(NOTEBOOK_LOCALES)('%s has no empty text, no em-dash and no stray markup', (locale) => {
		for (const [key, text] of Object.entries(NOTEBOOK_MESSAGES[locale])) {
			expect(text.trim(), key).not.toBe('');
			expect(text, key).not.toContain(String.fromCharCode(0x2014));
			expect(text, key).not.toMatch(/[<>]/u);
		}
	});

	it('gives every plural message a one and an other form', () => {
		const names = Object.keys(english)
			.filter((key) => key.endsWith('.other'))
			.map((key) => key.slice(0, -'.other'.length));
		expect(names.length).toBeGreaterThan(3);
		for (const name of names) expect(english[`${name}.one`], name).toBeDefined();
	});

	it('actually translates: no other locale repeats an English sentence', () => {
		for (const locale of others) {
			const same = Object.keys(english).filter(
				(key) => NOTEBOOK_MESSAGES[locale][key] === english[key],
			);
			const sentences = same.filter(
				(key) => /\s/u.test(english[key] ?? '') && !/[\d{]/u.test(english[key] ?? ''),
			);
			expect(sentences, locale).toEqual([]);
		}
	});
});

describe('notebookI18n', () => {
	it('maps tags to shipped locales and falls back to English, then the key', () => {
		expect(normalizeNotebookLocale('de-AT')).toBe('de');
		expect(normalizeNotebookLocale('zh-Hans')).toBe('zh-CN');
		expect(normalizeNotebookLocale('xx')).toBe('en');
		expect(notebookI18n('fr').t('container.move', { name: 'X' })).toBe('Déplacer X');
		expect(notebookI18n().t('no.such' as never)).toBe('no.such');
	});

	it('picks plurals and formats sizes in the locale', () => {
		expect(notebookI18n('en').tn('nav.results', 1)).toBe('1 result');
		expect(notebookI18n('en').tn('nav.results', 3)).toBe('3 results');
		expect(notebookI18n('de').tn('nav.results', 3)).toBe('3 Ergebnisse');
		expect(formatSize(2048, notebookI18n('en'))).toBe('2 KB');
		expect(formatSize(3_355_443, notebookI18n('fr'))).toBe('3,2 Mo');
	});
});
