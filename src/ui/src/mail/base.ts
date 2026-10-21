// Base of every mail element: a Lit element that takes part in locale inheritance (the shared
// `LocaleLitElement`), with `t` / `tn` translating in its locale and `emit` for its events. Each
// element keeps its reactive properties, a `render()` template and a sibling `.css` file.
import { unsafeCSS, type CSSResult } from 'lit';
import type { MessageParams } from 'ooxml-core/i18n';
import { withTokens } from '../base';
import { LocaleLitElement } from '../i18n/locale-element';
import { mailI18n, type MailI18n, type MailKey, type MailPluralKey } from './i18n/translator';
import resetCss from './reset.css?raw';

/** An element's style list: the mail reset, then its own `.css` file, tokens given defaults. */
export const mailStyles = (...sheets: string[]): CSSResult[] =>
	[resetCss, ...sheets].map((sheet) => unsafeCSS(withTokens(sheet)));

export class MailElement extends LocaleLitElement {
	protected get i18n(): MailI18n {
		return mailI18n(this.locale);
	}
	protected t(key: MailKey, params?: MessageParams): string {
		return this.i18n.t(key, params);
	}
	protected tn(key: MailPluralKey, count: number, params?: MessageParams): string {
		return this.i18n.tn(key, count, params);
	}

	/** Dispatch a bubbling, composed event (`mail-*`); returns false when a listener cancelled it. */
	protected emit<T>(type: string, detail: T, cancelable = false): boolean {
		return this.dispatchEvent(
			new CustomEvent(type, { detail, bubbles: true, composed: true, cancelable }),
		);
	}
}

/** Define `tag` once; a no-op without a DOM or when the tag is taken. */
export function defineOnce(tag: string, element: CustomElementConstructor): void {
	if (globalThis.customElements && !customElements.get(tag)) customElements.define(tag, element);
}
