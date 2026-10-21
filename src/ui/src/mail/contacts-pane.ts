// <mail-contacts>: the address book. A searchable list beside the selected contact, which can be
// edited, written to, deleted, and imported or exported as vCard (RFC 6350) files. Every change is
// an event; the app saves through the client.
import { html, nothing } from 'lit';
import {
	contactAddresses,
	contactLabel,
	emptyContact,
	searchContacts,
	type Contact,
	type ContactAddress,
} from 'ooxml-core/mail';
import { defineOnce, MailElement, mailStyles } from './base';
import { contactForm, readContactForm } from './contact-form';
import { hueOf, initials } from './format';
import { icon } from './icons';
import css from './contacts-pane.css?raw';

const newId = (): string =>
	globalThis.crypto?.randomUUID?.() ??
	`contact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** A contact's initials on the colour of its first address. */
function avatar(contact: Contact, large = false) {
	const email = contact.emails[0]?.address;
	return html`<span
		class=${large ? 'avatar large' : 'avatar'}
		style=${`--hue:${hueOf(email ?? contact.id)}`}
		aria-hidden="true"
		>${initials({ name: contactLabel(contact), email: email ?? '' })}</span
	>`;
}

/** A postal address on one line: street, extended, postal code and city, region, country. */
function postalLine(place: ContactAddress): string {
	const city = [place.postalCode, place.locality].filter(Boolean).join(' ');
	return [place.street, place.extended, city, place.region, place.country]
		.filter(Boolean)
		.join(', ');
}

export class MailContacts extends MailElement {
	static override styles = mailStyles(css);
	static override properties = {
		...MailElement.properties,
		contacts: { attribute: false },
		selectedId: { state: true },
		editing: { state: true },
		query: { state: true },
	};
	declare contacts: readonly Contact[];
	declare selectedId: string;
	/** The contact in the form (a copy), or null while reading. */
	declare editing: Contact | null;
	declare query: string;

	constructor() {
		super();
		this.contacts = [];
		this.selectedId = '';
		this.editing = null;
		this.query = '';
	}

	private get selected(): Contact | undefined {
		return this.contacts.find((c) => c.id === this.selectedId) ?? this.contacts[0];
	}

	private async importFile(input: HTMLInputElement): Promise<void> {
		const file = input.files?.[0];
		input.value = '';
		if (file) this.emit('mail-import-vcf', { text: await file.text() });
	}

	private save(event: Event): void {
		event.preventDefault();
		if (!this.editing) return;
		const contact = readContactForm(event.currentTarget as HTMLFormElement, this.editing);
		this.emit('mail-save-contact', { contact });
		this.selectedId = contact.id;
		this.editing = null;
	}

	private detail(contact: Contact) {
		const addresses = contactAddresses(contact);
		const place = contact.addresses[0];
		const line = (label: string, value: string) =>
			value ? html`<dt>${label}</dt><dd>${value}</dd>` : nothing;
		return html`<article class="detail">
			<header>
				${avatar(contact, true)}
				<div>
					<h2>${contactLabel(contact) || this.t('contacts.unnamed')}</h2>
					${contact.title || contact.organization ? html`<p class="sub">${[contact.title, contact.organization].filter(Boolean).join(', ')}</p>` : nothing}
				</div>
				<span class="tools">
					<button type="button" @click=${() => (this.editing = { ...contact })}
						>${icon('pencil')}<span>${this.t('contacts.edit')}</span></button
					>
					<button type="button" @click=${() => this.emit('mail-export-vcf', { ids: [contact.id] })}
						>${icon('mail-export')}<span>${this.t('contacts.exportOne')}</span></button
					>
					<button
						type="button"
						class="danger"
						@click=${() => {
							if (
								globalThis.confirm?.(
									this.t('contacts.confirmDelete', { name: contactLabel(contact) }),
								) === false
							)
								return;
							this.emit('mail-delete-contact', { id: contact.id });
						}}
						>${icon('trash')}<span>${this.t('contacts.delete')}</span></button
					>
				</span>
			</header>
			<dl>
				${addresses.map(
					(address, i) =>
						html`<dt>${this.t('contacts.email')}</dt
							><dd
								><button
									type="button"
									class="link"
									title=${this.t('contacts.writeTo', { address: address.email })}
									@click=${() => this.emit('mail-compose-to', { address })}
									>${address.email}</button
								>${contact.emails[i]?.type ? html` <small>${contact.emails[i]!.type}</small>` : nothing}</dd
							>`,
				)}
				${contact.phones.map((phone) => html`<dt>${this.t('contacts.phone')}</dt><dd>${phone.number}${phone.type ? html` <small>${phone.type}</small>` : nothing}</dd>`)}
				${place ? line(this.t('contacts.address'), postalLine(place)) : nothing}
				${line(this.t('contacts.birthday'), contact.birthday)}
				${line(this.t('contacts.website'), contact.url)}
				${line(this.t('contacts.note'), contact.note)}
			</dl>
		</article>`;
	}

	/** The form while editing, else the selected contact, else a note that none is selected. */
	private mainView(selected: Contact | undefined) {
		if (this.editing)
			return contactForm(this.editing, this.i18n, {
				save: (e) => this.save(e),
				cancel: () => (this.editing = null),
			});
		if (selected) return this.detail(selected);
		return html`<p class="empty">${this.t('contacts.nothingSelected')}</p>`;
	}

	protected override render() {
		const visible = searchContacts(this.contacts, this.query);
		const selected = this.selected;
		return html`<div class="pane">
			<section class="list" aria-label=${this.t('contacts.title')}>
				<div class="toolbar">
					<button
						type="button"
						class="primary"
						@click=${() => (this.editing = emptyContact(newId(), Date.now()))}
						>${icon('plus')}<span>${this.t('contacts.new')}</span></button
					>
					<label class="icon-button" title=${this.t('contacts.import')}
						>${icon('mail-import')}<span class="sr-only">${this.t('contacts.import')}</span>
						<input
							type="file"
							accept=".vcf,text/vcard,text/x-vcard"
							hidden
							@change=${(e: Event) => void this.importFile(e.currentTarget as HTMLInputElement)}
					/></label>
					<button
						type="button"
						class="icon-button"
						title=${this.t('contacts.exportAll')}
						aria-label=${this.t('contacts.exportAll')}
						?disabled=${!this.contacts.length}
						@click=${() => this.emit('mail-export-vcf', {})}
						>${icon('mail-export')}</button
					>
				</div>
				<input
					class="search"
					type="search"
					.value=${this.query}
					placeholder=${this.t('contacts.search')}
					aria-label=${this.t('contacts.search')}
					@input=${(e: Event) => (this.query = (e.currentTarget as HTMLInputElement).value)}
				/>
				<ul role="listbox" aria-label=${this.t('contacts.title')}>
					${visible.map(
						(contact) =>
							html`<li
								role="option"
								aria-selected=${contact.id === selected?.id ? 'true' : 'false'}
								@click=${() => {
									this.selectedId = contact.id;
									this.editing = null;
								}}
							>
								${avatar(contact)}
								<span class="who"
									><strong>${contactLabel(contact) || this.t('contacts.unnamed')}</strong
									><small>${contact.emails[0]?.address ?? contact.organization}</small></span
								>
							</li>`,
					)}
				</ul>
				${visible.length ? nothing : html`<p class="empty">${this.t(this.contacts.length ? 'contacts.noMatches' : 'contacts.empty')}</p>`}
			</section>
			<section class="main">${this.mainView(selected)}</section>
		</div>`;
	}
}

export function defineMailContacts(): void {
	defineOnce('mail-contacts', MailContacts);
}
