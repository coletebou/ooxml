// <notebook-link-dialog>: the Link dialog (Insert > Link, Ctrl+K) on the shared modal. Only
// addresses a viewer may open (http, https, mailto; the shared hyperlink policy) are accepted.
import { html, nothing } from 'lit';
import { isOpenableHyperlinkHref } from 'ooxml-core/opc';
import { controlStyles } from '../base';
import { definer } from '../registry';
import { NotebookElement } from './base';
import css from './link-dialog.css?raw';

export interface LinkDialogValue {
	href: string;
	/** The selected or linked text; empty when a new link is typed in at the cursor. */
	text: string;
	/** The selection already has a link (Remove link is offered). */
	linked: boolean;
}

type Dialog = HTMLElement & { show(): void; close(): void };

export class NotebookLinkDialog extends NotebookElement {
	static override styles = controlStyles(css);
	static override properties = {
		value: { attribute: false },
		invalid: { state: true },
	};
	declare value: LinkDialogValue | null;
	declare invalid: boolean;

	constructor() {
		super();
		this.value = null;
		this.invalid = false;
	}

	protected override updated(changed: Map<string, unknown>): void {
		if (!changed.has('value')) return;
		const dialog = this.renderRoot.querySelector<Dialog>('office-ui-dialog');
		if (this.value) {
			this.invalid = false;
			dialog?.show();
			queueMicrotask(() =>
				this.renderRoot.querySelector<HTMLInputElement>('input[name="href"]')?.focus(),
			);
		} else dialog?.close();
	}

	#field(name: string): string {
		return (
			this.renderRoot.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value.trim() ?? ''
		);
	}

	#apply(): void {
		const href = this.#field('href');
		if (!isOpenableHyperlinkHref(href)) {
			this.invalid = true;
			return;
		}
		this.fire('nb-link-apply', { href, text: this.#field('text') });
	}

	protected override render() {
		const value = this.value;
		return html`<office-ui-dialog
			heading=${this.t('link.title')}
			close-label=${this.t('common.close')}
			@office-dialog-close=${() => this.fire('nb-link-cancel', {})}
		>
			<label
				>${this.t('link.address')}
				<input
					name="href"
					type="url"
					.value=${value?.href ?? ''}
					aria-invalid=${String(this.invalid)}
					@keydown=${(e: KeyboardEvent) => e.key === 'Enter' && (e.preventDefault(), this.#apply())}
				/>
			</label>
			<label
				>${this.t('link.text')}
				<input
					name="text"
					type="text"
					.value=${value?.text ?? ''}
					?disabled=${!!value?.linked || !!value?.text}
				/>
			</label>
			${this.invalid ? html`<p class="error" role="alert">${this.t('link.invalid')}</p>` : nothing}
			${value?.linked ? html`<office-ui-button command="link-remove" slot="footer" label=${this.t('link.remove')} @office-command=${() => this.fire('nb-link-remove', {})}></office-ui-button>` : nothing}
			<office-ui-button
				command="link-ok"
				slot="footer"
				variant="primary"
				label=${this.t('common.ok')}
				@office-command=${() => this.#apply()}
			></office-ui-button>
			<office-ui-button
				command="link-cancel"
				slot="footer"
				label=${this.t('common.cancel')}
				@office-command=${() => this.fire('nb-link-cancel', {})}
			></office-ui-button>
		</office-ui-dialog>`;
	}
}

export const defineNotebookLinkDialog = definer('notebook-link-dialog', () => NotebookLinkDialog);
