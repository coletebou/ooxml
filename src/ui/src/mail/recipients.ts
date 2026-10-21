// <mail-recipients>: an address field (To, Cc, Bcc). Each address is a chip; typing suggests
// people from the address book; Enter, a comma, a semicolon or leaving the field turns the text into
// chips through the RFC 5322 address parser, so pasted lists (`"Ada" <ada@x>, bob@y`) split right.
import { html, nothing } from 'lit';
import {
	formatAddress,
	parseAddressList,
	sameAddress,
	suggestRecipients,
	type Contact,
	type MailAddress,
} from 'ooxml-core/mail';
import { defineOnce, MailElement, mailStyles } from './base';
import { icon } from './icons';
import css from './recipients.css?raw';

const VALID = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

export class MailRecipients extends MailElement {
	static override styles = mailStyles(css);
	static override properties = {
		...MailElement.properties,
		label: { type: String },
		addresses: { attribute: false },
		contacts: { attribute: false },
		text: { state: true },
		active: { state: true },
	};
	declare label: string;
	declare addresses: readonly MailAddress[];
	declare contacts: readonly Contact[];
	declare text: string;
	declare active: number;

	constructor() {
		super();
		this.label = '';
		this.addresses = [];
		this.contacts = [];
		this.text = '';
		this.active = 0;
	}

	private get suggestions(): MailAddress[] {
		return suggestRecipients(this.contacts, this.text).filter(
			(s) => !this.addresses.some((a) => sameAddress(a, s)),
		);
	}

	private change(addresses: readonly MailAddress[]): void {
		this.emit('mail-recipients-change', { addresses });
	}

	/** Turn the typed text into chips; true when something was added. */
	commit(): boolean {
		const parsed = parseAddressList(this.text).filter((a) => a.email);
		if (!parsed.length) return false;
		const added = parsed.filter((p) => !this.addresses.some((a) => sameAddress(a, p)));
		this.text = '';
		this.change([...this.addresses, ...added]);
		return true;
	}

	private pick(address: MailAddress): void {
		this.text = '';
		this.active = 0;
		this.change([...this.addresses, address]);
		this.renderRoot.querySelector('input')?.focus();
	}

	private keydown(event: KeyboardEvent): void {
		const suggestions = this.suggestions;
		if (event.key === 'ArrowDown' && suggestions.length) {
			event.preventDefault();
			this.active = (this.active + 1) % suggestions.length;
		} else if (event.key === 'ArrowUp' && suggestions.length) {
			event.preventDefault();
			this.active = (this.active - 1 + suggestions.length) % suggestions.length;
		} else if (
			(event.key === 'Enter' || event.key === 'Tab') &&
			suggestions.length &&
			this.text.trim()
		) {
			event.preventDefault();
			this.pick(suggestions[Math.min(this.active, suggestions.length - 1)]!);
		} else if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
			if (this.commit()) event.preventDefault();
		} else if (event.key === 'Backspace' && !this.text && this.addresses.length) {
			this.change(this.addresses.slice(0, -1));
		}
	}

	protected override render() {
		const suggestions = this.text.trim() ? this.suggestions : [];
		return html`<div class="field" @click=${() => this.renderRoot.querySelector('input')?.focus()}>
			<span class="label">${this.label}</span>
			<ul class="chips">
				${this.addresses.map(
					(address, index) =>
						html`<li
							class=${VALID.test(address.email) ? 'chip' : 'chip invalid'}
							title=${formatAddress(address)}
						>
							<span>${address.name || address.email}</span>
							<button
								type="button"
								aria-label=${this.t('compose.removeRecipient', { name: formatAddress(address) })}
								@click=${(e: Event) => {
									e.stopPropagation();
									this.change(this.addresses.filter((_, i) => i !== index));
								}}
								>${icon('close')}</button
							>
						</li>`,
				)}
				<li class="entry">
					<input
						type="text"
						autocomplete="off"
						role="combobox"
						aria-label=${this.label}
						aria-expanded=${suggestions.length ? 'true' : 'false'}
						aria-controls="suggestions"
						aria-activedescendant=${suggestions.length ? `suggestion-${this.active}` : nothing}
						.value=${this.text}
						@input=${(e: Event) => {
							this.text = (e.currentTarget as HTMLInputElement).value;
							this.active = 0;
						}}
						@keydown=${(e: KeyboardEvent) => this.keydown(e)}
						@blur=${() => setTimeout(() => this.commit(), 150)}
						@paste=${(e: ClipboardEvent) => {
							const pasted = e.clipboardData?.getData('text/plain') ?? '';
							if (!/[,;\n]/.test(pasted)) return;
							e.preventDefault();
							this.text = `${this.text}${pasted}`;
							this.commit();
						}}
					/>
				</li>
			</ul>
			${
				suggestions.length
					? html`<ul class="suggestions" id="suggestions" role="listbox">
							${suggestions.map(
								(s, i) =>
									html`<li
										id=${`suggestion-${i}`}
										role="option"
										aria-selected=${i === this.active ? 'true' : 'false'}
										@mousedown=${(e: Event) => {
											e.preventDefault();
											this.pick(s);
										}}
										><strong>${s.name || s.email}</strong
										>${s.name ? html` <span>${s.email}</span>` : nothing}</li
									>`,
							)}
						</ul>`
					: nothing
			}
		</div>`;
	}
}

export function defineMailRecipients(): void {
	defineOnce('mail-recipients', MailRecipients);
}
