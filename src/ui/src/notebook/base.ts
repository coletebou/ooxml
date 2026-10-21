// Shared foundation of the notebook elements: a Lit class on `OfficeElement` with Lit's batched
// updates (a page redraws once however many properties change), a `locale` and the notebook
// translator. The app hands its locale to the parts it renders, so parts never look it up.
import type { PropertyDeclarations } from 'lit';
import type { MessageParams } from 'ooxml-core/i18n';
import { OfficeElement } from '../base';
import {
	type NotebookI18n,
	type NotebookKey,
	type NotebookPluralKey,
	notebookI18n,
} from './i18n/translator';

export class NotebookElement extends OfficeElement {
	static override syncUpdates = false;
	static override properties: PropertyDeclarations = { locale: { type: String } };
	/** A BCP 47 tag (`de`, `zh-CN`); empty means English with the browser's date conventions. */
	declare locale: string;

	constructor() {
		super();
		this.locale = '';
	}

	protected get i18n(): NotebookI18n {
		return notebookI18n(this.locale);
	}
	protected t(key: NotebookKey, params?: MessageParams): string {
		return this.i18n.t(key, params);
	}
	protected tn(key: NotebookPluralKey, count: number, params?: MessageParams): string {
		return this.i18n.tn(key, count, params);
	}
}
