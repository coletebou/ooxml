// The contact edit form of <mail-contacts>: names, addresses, phones, one postal address, the
// organisation, birthday, website and note. Each list shows its entries plus one empty row to add
// another; empty rows are dropped on save. Fields the form does not show are kept as they were.
import { html } from 'lit';
import type { Contact, ContactAddress } from 'ooxml-core/mail';
import type { MailI18n, MailKey } from './i18n/translator';

/** A whole date (`YYYY-MM-DD`): the only birthday a date input can show. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_TYPES = ['', 'home', 'work', 'other'];
const PHONE_TYPES = ['', 'cell', 'home', 'work', 'fax', 'other'];
const TYPE_LABELS: Record<string, MailKey> = {
	'': 'contacts.typeNone',
	home: 'contacts.typeHome',
	work: 'contacts.typeWork',
	other: 'contacts.typeOther',
	cell: 'contacts.typeCell',
	fax: 'contacts.typeFax',
};

export interface ContactFormHandlers {
	save(event: Event): void;
	cancel(): void;
}

function typeSelect(name: string, value: string, types: readonly string[], i18n: MailI18n) {
	return html`<select name=${name} aria-label=${i18n.t('contacts.type')}>
		${types.map((type) => html`<option value=${type} ?selected=${type === value}>${i18n.t(TYPE_LABELS[type] ?? 'contacts.typeOther')}</option>`)}
	</select>`;
}

export function contactForm(contact: Contact, i18n: MailI18n, handlers: ContactFormHandlers) {
	const t = i18n.t;
	const place: Partial<ContactAddress> = contact.addresses[0] ?? {};
	const emails = [...contact.emails, { type: '', address: '' }];
	const phones = [...contact.phones, { type: '', number: '' }];
	const field = (name: string, label: string, value: string, type = 'text') =>
		html`<label><span>${label}</span><input name=${name} type=${type} .value=${value} /></label>`;
	return html`<form class="contact-form" @submit=${handlers.save}>
		<h2
			>${contact.name || contact.emails.length ? t('contacts.editTitle') : t('contacts.newTitle')}</h2
		>
		<fieldset>
			<legend>${t('contacts.nameGroup')}</legend>
			${field('name', t('contacts.displayName'), contact.name)}
			${field('givenName', t('contacts.givenName'), contact.givenName)}
			${field('familyName', t('contacts.familyName'), contact.familyName)}
		</fieldset>
		<fieldset>
			<legend>${t('contacts.email')}</legend>
			${emails.map((email, i) => html`<div class="row"><input name=${`email-${i}`} type="email" .value=${email.address} aria-label=${t('contacts.email')} />${typeSelect(`email-type-${i}`, email.type, EMAIL_TYPES, i18n)}</div>`)}
		</fieldset>
		<fieldset>
			<legend>${t('contacts.phone')}</legend>
			${phones.map((phone, i) => html`<div class="row"><input name=${`phone-${i}`} type="tel" .value=${phone.number} aria-label=${t('contacts.phone')} />${typeSelect(`phone-type-${i}`, phone.type, PHONE_TYPES, i18n)}</div>`)}
		</fieldset>
		<fieldset>
			<legend>${t('contacts.workGroup')}</legend>
			${field('organization', t('contacts.organization'), contact.organization)}
			${field('title', t('contacts.jobTitle'), contact.title)}
		</fieldset>
		<fieldset>
			<legend>${t('contacts.address')}</legend>
			${field('street', t('contacts.street'), place.street ?? '')}
			${field('locality', t('contacts.city'), place.locality ?? '')}
			${field('region', t('contacts.region'), place.region ?? '')}
			${field('postalCode', t('contacts.postalCode'), place.postalCode ?? '')}
			${field('country', t('contacts.country'), place.country ?? '')}
		</fieldset>
		<fieldset>
			<legend>${t('contacts.more')}</legend>
			${field('birthday', t('contacts.birthday'), ISO_DATE.test(contact.birthday) ? contact.birthday : '', 'date')}
			${field('url', t('contacts.website'), contact.url, 'url')}
			<label
				><span>${t('contacts.note')}</span
				><textarea name="note" rows="3" .value=${contact.note}></textarea>
			</label>
		</fieldset>
		<footer>
			<button type="submit" class="primary">${t('contacts.save')}</button>
			<button type="button" @click=${handlers.cancel}>${t('contacts.cancel')}</button>
		</footer>
	</form>`;
}

/** The contact the form describes, on top of `base` (what the form does not show stays). */
export function readContactForm(form: HTMLFormElement, base: Contact): Contact {
	const data = new FormData(form);
	const value = (name: string): string => String(data.get(name) ?? '').trim();
	const rows = (prefix: string): { value: string; type: string }[] =>
		[...data.keys()]
			.filter((key) => new RegExp(`^${prefix}-\\d+$`).test(key))
			.map((key) => ({
				value: value(key),
				type: value(key.replace(`${prefix}-`, `${prefix}-type-`)),
			}))
			.filter((row) => row.value);
	const street = value('street');
	const locality = value('locality');
	const region = value('region');
	const postalCode = value('postalCode');
	const country = value('country');
	const first = base.addresses[0];
	const hasPlace = street || locality || region || postalCode || country;
	const birthday = value('birthday') || (ISO_DATE.test(base.birthday) ? '' : base.birthday);
	return {
		...base,
		name: value('name'),
		givenName: value('givenName'),
		familyName: value('familyName'),
		emails: rows('email').map((row) => ({ type: row.type, address: row.value })),
		phones: rows('phone').map((row) => ({ type: row.type, number: row.value })),
		organization: value('organization'),
		title: value('title'),
		addresses: hasPlace
			? [
					{
						type: first?.type ?? '',
						poBox: first?.poBox ?? '',
						extended: first?.extended ?? '',
						street,
						locality,
						region,
						postalCode,
						country,
					},
					...base.addresses.slice(1),
				]
			: base.addresses.slice(1),
		birthday,
		url: value('url'),
		note: value('note'),
	};
}
