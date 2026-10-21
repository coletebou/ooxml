// Locale plumbing of the Teams elements: the shared locale-host inheritance (`../../i18n/locale-host`,
// where it now lives for every product UI) plus the Teams translator of a host.
import { teamsI18n, type TeamsI18n } from './translator';

export { LOCALE_HOST, inheritLocale, pushLocale, type LocaleHost } from '../../i18n/locale-host';

export const i18nOf = (host: { locale: string }): TeamsI18n => teamsI18n(host.locale);
