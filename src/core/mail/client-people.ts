// The address book and calendar actions of the mail client: edit, delete, and import and export
// vCard (RFC 6350) and iCalendar (RFC 5545) files. What an import could not read is reported in a
// warning notice, never dropped silently. New code.
import { eventsToIcs } from '../calendar/ics-write';
import { parseIcs } from '../calendar/ics-read';
import type { ClientCore } from './client-core';
import type { MailClient } from './client-types';
import { sortContacts } from './contacts';
import { parseVCards, serializeVCards } from './vcard';

type PeopleActions = Pick<
	MailClient,
	| 'saveContact'
	| 'deleteContact'
	| 'importVCards'
	| 'exportVCards'
	| 'saveEvent'
	| 'deleteEvent'
	| 'importIcs'
	| 'exportIcs'
>;

export interface PeopleLoader extends PeopleActions {
	load(): Promise<void>;
}

const PROD_ID = '-//ooxml//Mail//EN';
/** The domain of the UIDs exported events get, so importing the file again finds the same events. */
const UID_DOMAIN = 'ooxml-mail.invalid';

export function createPeople(core: ClientCore): PeopleLoader {
	const contacts = core.options.contacts;
	const calendar = core.options.calendar;

	const guard = async (
		action: 'contacts' | 'calendar',
		run: () => Promise<void>,
	): Promise<void> => {
		try {
			await run();
		} catch (error) {
			core.fail(action, error);
		}
	};
	const loadContacts = (): Promise<void> =>
		guard('contacts', async () => {
			if (contacts) core.patch({ contacts: sortContacts(await contacts.list()) });
		});
	const loadEvents = (): Promise<void> =>
		guard('calendar', async () => {
			if (!calendar) return;
			const events = await calendar.list();
			core.patch({ events: [...events].sort((a, b) => a.start - b.start) });
		});

	return {
		load: async () => {
			await Promise.all([loadContacts(), loadEvents()]);
		},
		saveContact: (contact) =>
			guard('contacts', async () => {
				await contacts?.save({ ...contact, updatedAt: core.now() });
				await loadContacts();
			}),
		deleteContact: (id) =>
			guard('contacts', async () => {
				await contacts?.remove(id);
				await loadContacts();
			}),
		async importVCards(text) {
			if (!contacts) return 0;
			const { contacts: read, skipped } = parseVCards(text);
			let count = 0;
			await guard('contacts', async () => {
				for (const contact of read) {
					await contacts.save(contact);
					count++;
				}
				await loadContacts();
			});
			if (count) core.notice({ kind: 'done', action: 'contactsImported', count });
			if (skipped) core.notice({ kind: 'warning', action: 'contactsImported', skipped });
			return count;
		},
		exportVCards(ids) {
			const wanted = ids ? new Set(ids) : null;
			return serializeVCards(
				core.state.contacts.filter((contact) => !wanted || wanted.has(contact.id)),
			);
		},
		saveEvent: (event) =>
			guard('calendar', async () => {
				await calendar?.save(event);
				await loadEvents();
			}),
		deleteEvent: (id) =>
			guard('calendar', async () => {
				await calendar?.remove(id);
				await loadEvents();
			}),
		async importIcs(text, zone) {
			if (!calendar) return 0;
			const { events, unsupported } = parseIcs(text, {
				uidDomain: UID_DOMAIN,
				...(zone ? { zone } : {}),
			});
			let count = 0;
			await guard('calendar', async () => {
				for (const event of events) {
					await calendar.save(event);
					count++;
				}
				await loadEvents();
			});
			if (count) core.notice({ kind: 'done', action: 'eventsImported', count });
			if (unsupported.length)
				core.notice({ kind: 'warning', action: 'eventsImported', unsupported });
			return count;
		},
		exportIcs(ids) {
			const wanted = ids ? new Set(ids) : null;
			return eventsToIcs(
				core.state.events.filter((event) => !wanted || wanted.has(event.id)),
				{ prodId: PROD_ID, uidDomain: UID_DOMAIN, now: core.now() },
			);
		},
	};
}
