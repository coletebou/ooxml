// A Lit element that takes part in locale inheritance (see `locale-host.ts`): it has a `locale`,
// takes the enclosing product element's when it has none, and hands a change on to the elements it
// rendered. Product bases add their own translator on top.
import { LitElement, type PropertyDeclarations, type PropertyValues } from 'lit';
import {
	inheritLocale,
	LOCALE_HOST,
	localeWritten,
	pushLocale,
	type LocaleHost,
} from './locale-host';

export class LocaleLitElement extends LitElement {
	static override properties: PropertyDeclarations = { locale: { type: String } };
	/** A BCP 47 tag (`de`, `zh-CN`); empty inherits the enclosing element's, else English. */
	declare locale: string;

	constructor() {
		super();
		this.locale = '';
	}

	get [LOCALE_HOST](): true {
		return true;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		inheritLocale(this as unknown as LocaleHost);
	}

	// Lit's setter calls this for every write, an unchanged value too: a locale set here is its own.
	override requestUpdate(...args: Parameters<LitElement['requestUpdate']>): void {
		if (args[0] === 'locale') localeWritten(this as unknown as LocaleHost);
		super.requestUpdate(...args);
	}

	protected override update(changed: PropertyValues): void {
		// A locale cleared on the element: the enclosing one again, before this update draws.
		if (changed.has('locale') && !this.locale) inheritLocale(this as unknown as LocaleHost);
		super.update(changed);
		if (changed.has('locale')) pushLocale(this as unknown as LocaleHost);
	}
}
