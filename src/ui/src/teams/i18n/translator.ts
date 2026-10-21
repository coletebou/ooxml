// The Teams translation layer: one dictionary per locale (`locales/<locale>/*.ts`, English is the
// contract) over the product translator the product UIs share (`../../i18n/product-i18n`): the
// `ooxml-core/i18n` lookup and `{placeholder}` filling, and `Intl` for plurals, dates and times. A
// missing key falls back to English, then to the key.
import {
	SUPPORTED_OFFICE_LOCALES,
	type MessageDictionary,
	type MessageParams,
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

export type TeamsLocale = OfficeLocale;
export const TEAMS_LOCALES = SUPPORTED_OFFICE_LOCALES;

/** Every key of the English dictionary, the contract of all locales. */
export type TeamsKey = keyof typeof en;
/** A plural message is stored as `<name>.one` and `<name>.other`; this is the shared `<name>`. */
export type TeamsPluralKey = PluralKeyOf<TeamsKey>;

export type TeamsTranslate = (key: TeamsKey, params?: MessageParams) => string;
export type TeamsPlural = (key: TeamsPluralKey, count: number, params?: MessageParams) => string;

/** `ProductI18n` over the Teams keys (see `../../i18n/product-i18n`). */
export type TeamsI18n = ProductI18n<TeamsKey>;

/** Every locale's dictionary. */
export const TEAMS_MESSAGES: Readonly<Record<TeamsLocale, MessageDictionary>> = {
	en,
	de,
	es,
	fr,
	'zh-CN': zhCN,
};

/** Maps any BCP 47 tag (`de-AT`, `zh-Hans`, `fr_CA`) to a shipped locale, else English. */
export const normalizeTeamsLocale = normalizeProductLocale;

/** The translator for a locale tag. Cached; an empty tag means English with the browser's dates. */
export const teamsI18n: (input?: string | null) => TeamsI18n =
	createProductI18n<TeamsKey>(TEAMS_MESSAGES);
