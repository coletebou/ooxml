// The address book and calendar actions of the mail client: edit, delete, and import and export
// vCard (RFC 6350) and iCalendar (RFC 5545) files. What an import could not read is reported in a
// warning notice, never dropped silently. After every change the list shows what the store holds,
// whether the change went through or not; a change the store kept but could not persist is
// reported as `storage`. New code.
import { eventsToIcs } from '../calendar/ics-write';
import { parseIcs } from '../calendar/ics-read';
import { errorCode, type ClientCore } from './client-core';
import type { MailClient } from './client-types';
import { sortContacts } from './contacts';
import type { RecordStore } from './record-store';
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

type Book = 'contacts' | 'calendar';

/**
 * Saves each record, calling `taken` for each one the store then holds. A write its storage refused
 * keeps the record, so the rest are saved too and the refusal is thrown once, at the end; any other
 * failure stops there.
 */
async function saveAll<T extends { id: string }>(
	store: RecordStore<T>,
	records: readonly T[],
	taken: () => void,
): Promise<void> {
	let refused: unknown;
	for (const record of records) {
		try {
			await store.save(record);
		} catch (error) {
			if (errorCode(error) !== 'storage') throw error;
			refused ??= error;
		}
		taken();
	}
	if (refused !== undefined) throw refused;
}

export function createPeople(core: ClientCore): PeopleLoader {
	const contacts = core.options.contacts;
	const calendar = core.options.calendar;

	const guard = async (action: Book, run: () => Promise<void>): Promise<void> => {
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
	/** A change, its failure reported, then the list as the store holds it either way. */
	const change = async (action: Book, run: () => Promise<unknown> | undefined): Promise<void> => {
		await guard(action, async () => {
			await run();
		});
		await (action === 'contacts' ? loadContacts() : loadEvents());
	};

	return {
		load: async () => {
			await Promise.all([loadContacts(), loadEvents()]);
		},
		saveContact: (contact) =>
			change('contacts', () => contacts?.save({ ...contact, updatedAt: core.now() })),
		deleteContact: (id) => change('contacts', () => contacts?.remove(id)),
		async importVCards(text) {
			if (!contacts) return 0;
			const { contacts: read, skipped } = parseVCards(text);
			let count = 0;
			await change('contacts', () => saveAll(contacts, read, () => count++));
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
		saveEvent: (event) => change('calendar', () => calendar?.save(event)),
		deleteEvent: (id) => change('calendar', () => calendar?.remove(id)),
		async importIcs(text, zone) {
			if (!calendar) return 0;
			let count = 0;
			let unsupported: string[] = [];
			await change('calendar', async () => {
				// An event without a UID gets an id no stored event has, so it never replaces one, and an
				// update to one occurrence of a stored series changes that occurrence of it.
				const stored = new Map((await calendar.list()).map((event) => [event.id, event]));
				const read = parseIcs(text, {
					uidDomain: UID_DOMAIN,
					...(zone ? { zone } : {}),
					taken: (id) => stored.has(id),
					stored: (id) => stored.get(id),
				});
				unsupported = read.unsupported;
				await saveAll(calendar, read.events, () => count++);
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
