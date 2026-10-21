// The Calendar and Contacts views of <mail-app>: the panes with their events turned into client
// actions, and files written out as downloads.
import { html } from 'lit';
import { localZone, type CalendarEvent } from 'ooxml-core/calendar';
import type { Contact, MailAddress, MailClient, MailState } from 'ooxml-core/mail';
import { downloadBytes } from './app-mail-view';
import type { MailApp } from './mail-app';

const text = (app: MailApp, value: string, name: string, type: string): void =>
	downloadBytes(app.ownerDocument, new TextEncoder().encode(value), name, type);

export function calendarView(app: MailApp, mail: MailClient, state: MailState) {
	const zone = localZone();
	return html`<mail-calendar
		.events=${state.events}
		.zone=${zone}
		@mail-save-event=${(e: CustomEvent<{ event: CalendarEvent }>) => void mail.saveEvent(e.detail.event)}
		@mail-delete-event=${(e: CustomEvent<{ id: string }>) => void mail.deleteEvent(e.detail.id)}
		@mail-import-ics=${(e: CustomEvent<{ text: string }>) => void mail.importIcs(e.detail.text, zone)}
		@mail-export-ics=${(e: CustomEvent<{ ids?: string[] }>) => text(app, mail.exportIcs(e.detail.ids), 'calendar.ics', 'text/calendar')}
	></mail-calendar>`;
}

export function contactsView(app: MailApp, mail: MailClient, state: MailState) {
	return html`<mail-contacts
		.contacts=${state.contacts}
		@mail-save-contact=${(e: CustomEvent<{ contact: Contact }>) => void mail.saveContact(e.detail.contact)}
		@mail-delete-contact=${(e: CustomEvent<{ id: string }>) => void mail.deleteContact(e.detail.id)}
		@mail-import-vcf=${(e: CustomEvent<{ text: string }>) => void mail.importVCards(e.detail.text)}
		@mail-export-vcf=${(e: CustomEvent<{ ids?: string[] }>) => text(app, mail.exportVCards(e.detail.ids), 'contacts.vcf', 'text/vcard')}
		@mail-compose-to=${async (e: CustomEvent<{ address: MailAddress }>) => {
			app.view = 'mail';
			await mail.compose('new');
			mail.updateDraft({ to: [e.detail.address] });
		}}
	></mail-contacts>`;
}
