// The translation layer the product UIs share (Teams, Mail): one dictionary per shipped locale,
// English as the contract, the `ooxml-core/i18n` translator for lookup and `{placeholder}` filling,
// and `Intl` for plural rules. A missing key falls back to English, then to the key. Extracted from
// `teams/i18n/translator.ts`; behaviour unchanged.
import {
	createTranslator,
	normalizeLocale,
	SUPPORTED_OFFICE_LOCALES,
	type MessageDictionary,
	type MessageParams,
	type OfficeLocale,
} from 'ooxml-core/i18n';

/** A plural message is stored as `<name>.one` and `<name>.other`; this is the shared `<name>`. */
export type PluralKeyOf<K extends string> = K extends `${infer Name}.other` ? Name : never;

export interface ProductI18n<K extends string> {
	/** The resolved display locale (`en` when none was asked for). */
	readonly locale: OfficeLocale;
	/**
	 * The locale `Intl` formats dates and numbers in. Undefined while no locale was asked for, so
	 * a host that never sets one keeps the browser's own date and time conventions.
	 */
	readonly intl: string | undefined;
	readonly t: (key: K, params?: MessageParams) => string;
	/** `tn('mail.messages', 3)` picks `mail.messages.one` or `.other` by the locale's plural rules. */
	readonly tn: (key: PluralKeyOf<K>, count: number, params?: MessageParams) => string;
}

/** Maps any BCP 47 tag (`de-AT`, `zh-Hans`, `fr_CA`) to a shipped locale, else English. */
export function normalizeProductLocale(input: string | null | undefined): OfficeLocale {
	return normalizeLocale(input, SUPPORTED_OFFICE_LOCALES, 'en');
}

/**
 * A cached translator factory over `messages`: `i18n('de').t('key')`. An empty tag means English
 * with the browser's own date conventions (`intl` undefined).
 */
export function createProductI18n<K extends string>(
	messages: Readonly<Record<OfficeLocale, MessageDictionary>>,
): (input?: string | null) => ProductI18n<K> {
	const cache = new Map<string, ProductI18n<K>>();
	return (input) => {
		const asked = (input ?? '').trim();
		const hit = cache.get(asked);
		if (hit) return hit;
		const locale = normalizeProductLocale(asked);
		const translate = createTranslator(messages[locale], [messages.en]);
		const rules = new Intl.PluralRules(locale);
		const made: ProductI18n<K> = {
			locale,
			intl: asked ? locale : undefined,
			t: translate,
			tn: (key, count, params) =>
				translate(`${key}.${rules.select(count) === 'one' ? 'one' : 'other'}`, {
					count,
					...params,
				}),
		};
		cache.set(asked, made);
		return made;
	};
}
