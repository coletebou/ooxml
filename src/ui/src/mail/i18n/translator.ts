// The mail app's dictionaries (`locales/<locale>/*.ts`, English is the contract) over the product
// translator every product UI shares. A missing key falls back to English, then to the key.
import {
	SUPPORTED_OFFICE_LOCALES,
	type MessageDictionary,
	type OfficeLocale,
} from 'ooxml-core/i18n';
import {
	createProductI18n,
	normalizeProductLocale,
	type PluralKeyOf,
	type ProductI18n,
} from '../../i18n/product-i18n';
import { de } from './locales/de';
import { en } from './locales/en';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { zhCN } from './locales/zh-CN';

export type MailLocale = OfficeLocale;
export const MAIL_LOCALES = SUPPORTED_OFFICE_LOCALES;

/** Every key of the English dictionary, the contract of all locales. */
export type MailKey = keyof typeof en;
export type MailPluralKey = PluralKeyOf<MailKey>;
export type MailI18n = ProductI18n<MailKey>;

export const MAIL_MESSAGES: Readonly<Record<MailLocale, MessageDictionary>> = {
	en,
	de,
	es,
	fr,
	'zh-CN': zhCN,
};

/** Maps any BCP 47 tag (`de-AT`, `zh-Hans`) to a shipped locale, else English. */
export const normalizeMailLocale = normalizeProductLocale;

/** The translator for a locale tag. Cached; an empty tag means English with the browser's dates. */
export const mailI18n: (input?: string | null) => MailI18n =
	createProductI18n<MailKey>(MAIL_MESSAGES);
