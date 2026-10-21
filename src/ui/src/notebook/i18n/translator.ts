// The notebook's translation layer, the same shape as the Teams one: one dictionary per locale
// (English is the contract), the shared `ooxml-core/i18n` translator for lookup and
// `{placeholder}` filling, `Intl` for plurals, dates and sizes. A missing key falls back to
// English, then to the key.
import {
	createTranslator,
	normalizeLocale,
	SUPPORTED_OFFICE_LOCALES,
	type MessageDictionary,
	type MessageParams,
	type OfficeLocale,
} from 'ooxml-core/i18n';
import { de } from './locales/de';
import { en } from './locales/en';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { zhCN } from './locales/zh-CN';

export type NotebookLocale = OfficeLocale;
export const NOTEBOOK_LOCALES = SUPPORTED_OFFICE_LOCALES;

/** Every key of the English dictionary, the contract of all locales. */
export type NotebookKey = keyof typeof en;
/** A plural message is stored as `<name>.one` and `<name>.other`; this is the shared `<name>`. */
export type NotebookPluralKey = NotebookKey extends infer K
	? K extends `${infer Name}.other`
		? Name
		: never
	: never;

export interface NotebookI18n {
	readonly locale: NotebookLocale;
	/** The locale `Intl` formats in; undefined while none was asked for (the browser's own). */
	readonly intl: string | undefined;
	readonly t: (key: NotebookKey, params?: MessageParams) => string;
	readonly tn: (key: NotebookPluralKey, count: number, params?: MessageParams) => string;
}

export const NOTEBOOK_MESSAGES: Readonly<Record<NotebookLocale, MessageDictionary>> = {
	en,
	de,
	es,
	fr,
	'zh-CN': zhCN,
};

export function normalizeNotebookLocale(input: string | null | undefined): NotebookLocale {
	return normalizeLocale(input, NOTEBOOK_LOCALES, 'en');
}

const cache = new Map<string, NotebookI18n>();

/** The translator for a locale tag (cached); an empty tag means English with the browser's dates. */
export function notebookI18n(input?: string | null): NotebookI18n {
	const asked = (input ?? '').trim();
	const hit = cache.get(asked);
	if (hit) return hit;
	const locale = normalizeNotebookLocale(asked);
	const translate = createTranslator(NOTEBOOK_MESSAGES[locale], [NOTEBOOK_MESSAGES.en]);
	const rules = new Intl.PluralRules(locale);
	const made: NotebookI18n = {
		locale,
		intl: asked ? locale : undefined,
		t: translate as NotebookI18n['t'],
		tn: (key, count, params) =>
			translate(`${key}.${rules.select(count) === 'one' ? 'one' : 'other'}`, { count, ...params }),
	};
	cache.set(asked, made);
	return made;
}

/** A byte count in the locale (`12 KB`). */
export function formatSize(bytes: number, i18n: NotebookI18n): string {
	const number = (n: number, digits = 0): string =>
		new Intl.NumberFormat(i18n.intl, {
			maximumFractionDigits: digits,
			minimumFractionDigits: digits,
		}).format(n);
	if (bytes < 1024) return i18n.t('size.bytes', { size: number(bytes) });
	if (bytes < 1_048_576) return i18n.t('size.kb', { size: number(Math.round(bytes / 1024)) });
	return i18n.t('size.mb', { size: number(bytes / 1_048_576, 1) });
}

/** The page date line: weekday, date and time in the locale. */
export function formatCreated(ts: number, i18n: NotebookI18n): { date: string; time: string } {
	const when = new Date(ts);
	return {
		date: when.toLocaleDateString(i18n.intl, {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric',
		}),
		time: when.toLocaleTimeString(i18n.intl, { hour: 'numeric', minute: '2-digit' }),
	};
}
