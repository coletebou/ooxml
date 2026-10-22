// The address book and calendar actions of the mail client: edit, delete, and import and export
// vCard (RFC 6350) and iCalendar (RFC 5545) files. What an import could not read is reported in a
// warning notice, never dropped silently. After every change the list shows what the store holds,
// whether the change went through or not; a change the store kept but could not persist is
// reported as `storage`. New code.
import { eventsToIcs } from '../calendar/ics-write';
import { parseIcs } from '../calendar/ics-read';
import { errorCode, type ClientCore } from './client-core';
import type { MailClient, MailClientOptions } from './client-types';
import { sortContacts } from './contacts';
import type { RecordStore } from './record-store';
import { MailTransportError } from './transport';
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

export function createPeople(core: ClientCore, connect: () => Promise<void>): PeopleLoader {
	type Stores = Pick<MailClientOptions, 'contacts' | 'calendar'>;
	/** Each store, or undefined where there is none. */
	type Open = { [K in keyof Stores]-?: Stores[K] | undefined };
	let opened: Stores | null = null;
	/** The host's own stores, else, once a connection worked, those opened for its account. */
	const stores = (): Open => {
		const { contacts, calendar, openStores } = core.options;
		if (!opened && core.session && openStores && !(contacts && calendar))
			opened = openStores(core.session);
		return { contacts: contacts ?? opened?.contacts, calendar: calendar ?? opened?.calendar };
	};
	/**
	 * The store a change goes to. Its account's, before the account is known, once the connection
	 * under way (or a new attempt) has made it known; failing that, the change fails with what
	 * stopped the connection, so it is never dropped without a word. Undefined for a client given
	 * no such store.
	 */
	/** `storeFor`, a failure reported as the action's error: undefined then, or without a store. */
	const storeOrFail = async <K extends keyof Open>(kind: K): Promise<Open[K]> => {
		try {
			return await storeFor(kind);
		} catch (error) {
			core.fail(kind, error);
			return undefined;
		}
	};
	const storeFor = async <K extends keyof Open>(kind: K): Promise<Open[K]> => {
		const store = stores()[kind];
		if (store || !core.options.openStores || core.session) return store;
		await connect();
		const opened = stores()[kind];
		if (opened) return opened;
		throw new MailTransportError(
			core.state.error ?? 'network',
			'The address book and the calendar open once the account has connected.',
		);
	};

	const guard = async (action: Book, run: () => Promise<void>): Promise<void> => {
		try {
			await run();
		} catch (error) {
			core.fail(action, error);
		}
	};
	const loadContacts = (): Promise<void> =>
		guard('contacts', async () => {
			const { contacts } = stores();
			if (contacts) core.patch({ contacts: sortContacts(await contacts.list()) });
		});
	const loadEvents = (): Promise<void> =>
		guard('calendar', async () => {
			const { calendar } = stores();
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
			change('contacts', async () =>
				(await storeFor('contacts'))?.save({ ...contact, updatedAt: core.now() }),
			),
		deleteContact: (id) => change('contacts', async () => (await storeFor('contacts'))?.remove(id)),
		async importVCards(text) {
			const contacts = await storeOrFail('contacts');
			if (!contacts) return 0;
			const { contacts: read, skipped, partial } = parseVCards(text);
			let count = 0;
			await change('contacts', () => saveAll(contacts, read, () => count++));
			if (count) core.notice({ kind: 'done', action: 'contactsImported', count });
			if (skipped || partial)
				core.notice({ kind: 'warning', action: 'contactsImported', skipped, partial });
			return count;
		},
		exportVCards(ids) {
			const wanted = ids ? new Set(ids) : null;
			return serializeVCards(
				core.state.contacts.filter((contact) => !wanted || wanted.has(contact.id)),
			);
		},
		saveEvent: (event) => change('calendar', async () => (await storeFor('calendar'))?.save(event)),
		deleteEvent: (id) => change('calendar', async () => (await storeFor('calendar'))?.remove(id)),
		async importIcs(text, zone) {
			const calendar = await storeOrFail('calendar');
			if (!calendar) return 0;
			let count = 0;
			let unsupported: string[] = [];
			await change('calendar', async () => {
				// An event without a UID gets an id no stored event has, so it never replaces one, and an
				// update to one occurrence of a stored series changes that occurrence of it.
				const stored = new Map((await calendar.list()).map((event) => [event.id, event]));
				const byUid = new Map(
					[...stored.values()].flatMap((event) => (event.uid ? [[event.uid, event] as const] : [])),
				);
				const read = parseIcs(text, {
					uidDomain: UID_DOMAIN,
					...(zone ? { zone } : {}),
					taken: (id) => stored.has(id),
					stored: (id) => stored.get(id),
					storedByUid: (uid) => byUid.get(uid),
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
