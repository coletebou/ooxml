// Contacts: the address book model (the vCard properties a person edits), search and suggestion
// helpers, and the store the client reads and writes through. Pure data, no DOM. New code.
import type { MailAddress } from './model';
import { createMemoryRecordStore, type MemoryStoreOptions, type RecordStore } from './record-store';

export interface ContactEmail {
	/** `home`, `work`, `other` or empty. */
	type: string;
	address: string;
}

export interface ContactPhone {
	/** `cell`, `home`, `work`, `fax`, `other` or empty. */
	type: string;
	number: string;
}

/** An `ADR` value with all seven components of RFC 6350 section 6.3.1. */
export interface ContactAddress {
	type: string;
	poBox: string;
	/** Apartment or suite. */
	extended: string;
	street: string;
	locality: string;
	region: string;
	postalCode: string;
	country: string;
}

export interface Contact {
	/** The vCard `UID`. */
	id: string;
	/** The formatted name (`FN`). */
	name: string;
	givenName: string;
	familyName: string;
	/** The other `N` components: middle names, honorific prefixes and suffixes (comma-separated). */
	additionalNames: string;
	prefix: string;
	suffix: string;
	emails: readonly ContactEmail[];
	phones: readonly ContactPhone[];
	addresses: readonly ContactAddress[];
	organization: string;
	/** The organizational units after the organization name in `ORG`. */
	organizationUnits: readonly string[];
	title: string;
	/** `YYYY-MM-DD`, `--MM-DD` (no year) or empty. */
	birthday: string;
	note: string;
	url: string;
	updatedAt: number;
	/** vCard lines this model does not edit (`PHOTO`, `X-...`), kept as read so export keeps them. */
	extra: readonly string[];
}

export const MAX_CONTACT_FIELD_CHARS = 2000;

/** An empty contact with a fresh id, for the New contact form. */
export function emptyContact(id: string, now: number): Contact {
	return {
		id,
		name: '',
		givenName: '',
		familyName: '',
		additionalNames: '',
		prefix: '',
		suffix: '',
		emails: [],
		phones: [],
		addresses: [],
		organization: '',
		organizationUnits: [],
		title: '',
		birthday: '',
		note: '',
		url: '',
		updatedAt: now,
		extra: [],
	};
}

/**
 * The name to show: the formatted name, else given and family name, else the first address, else
 * the organization.
 */
export function contactLabel(contact: Contact): string {
	return (
		contact.name.trim() ||
		[contact.givenName, contact.familyName].filter(Boolean).join(' ').trim() ||
		contact.emails[0]?.address ||
		contact.organization
	);
}

/** Each address of a contact as a mail recipient. */
export function contactAddresses(contact: Contact): MailAddress[] {
	const name = contactLabel(contact);
	return contact.emails
		.filter((email) => email.address)
		.map((email) => ({ name: name === email.address ? '' : name, email: email.address }));
}

const fold = (text: string): string => text.normalize('NFKC').toLowerCase();

/** Contacts whose name, organization or any address contains every word of `query`. */
export function searchContacts(contacts: readonly Contact[], query: string): Contact[] {
	const words = fold(query).split(/\s+/).filter(Boolean);
	if (!words.length) return [...contacts];
	return contacts.filter((contact) => {
		const haystack = fold(
			[
				contactLabel(contact),
				contact.givenName,
				contact.familyName,
				contact.organization,
				...contact.emails.map((email) => email.address),
				...contact.phones.map((phone) => phone.number),
			].join(' '),
		);
		return words.every((word) => haystack.includes(word));
	});
}

/** Address-book order: by label, case- and accent-insensitive, then by id. */
export function sortContacts(contacts: readonly Contact[], locale?: string): Contact[] {
	const collator = new Intl.Collator(locale, { sensitivity: 'base' });
	return [...contacts].sort(
		(a, b) => collator.compare(contactLabel(a), contactLabel(b)) || a.id.localeCompare(b.id),
	);
}

/** 0 when the name or address starts with `needle`, 1 when one contains it, else -1. */
function matchScore(address: MailAddress, needle: string): number {
	const name = fold(address.name);
	const email = fold(address.email);
	if (name.startsWith(needle) || email.startsWith(needle)) return 0;
	if (name.includes(needle) || email.includes(needle)) return 1;
	return -1;
}

/** Recipient suggestions for a compose field, best matches (prefix of name or address) first. */
export function suggestRecipients(
	contacts: readonly Contact[],
	query: string,
	limit = 8,
): MailAddress[] {
	const needle = fold(query.trim());
	if (!needle) return [];
	const scored: { address: MailAddress; score: number }[] = [];
	for (const contact of contacts) {
		for (const address of contactAddresses(contact)) {
			const score = matchScore(address, needle);
			if (score >= 0) scored.push({ address, score });
		}
	}
	return scored
		.sort((a, b) => a.score - b.score || a.address.email.localeCompare(b.address.email))
		.slice(0, limit)
		.map((entry) => entry.address);
}

export type ContactStore = RecordStore<Contact>;

const clip = (value: unknown): string =>
	typeof value === 'string' ? value.slice(0, MAX_CONTACT_FIELD_CHARS) : '';

/**
 * A kept vCard line, whole however long (a `PHOTO` holds a whole image, and a cut one is a broken
 * one): one content line, never a card boundary, either of which would split the card on export.
 */
const keptLine = (value: unknown): string =>
	typeof value === 'string' && !/[\r\n]/.test(value) && !/^(?:BEGIN|END)[;:]/i.test(value)
		? value
		: '';

/** Re-validate a stored contact (storage is shared with other code and may be stale or edited). */
export function sanitizeContact(raw: unknown): Contact | null {
	if (!raw || typeof raw !== 'object') return null;
	const value = raw as Record<string, unknown>;
	const id = clip(value.id);
	if (!id) return null;
	const list = <T>(items: unknown, map: (item: Record<string, unknown>) => T): T[] =>
		Array.isArray(items)
			? items
					.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
					.slice(0, 50)
					.map(map)
			: [];
	return {
		id,
		name: clip(value.name),
		givenName: clip(value.givenName),
		familyName: clip(value.familyName),
		additionalNames: clip(value.additionalNames),
		prefix: clip(value.prefix),
		suffix: clip(value.suffix),
		emails: list(value.emails, (item) => ({ type: clip(item.type), address: clip(item.address) })),
		phones: list(value.phones, (item) => ({ type: clip(item.type), number: clip(item.number) })),
		addresses: list(value.addresses, (item) => ({
			type: clip(item.type),
			poBox: clip(item.poBox),
			extended: clip(item.extended),
			street: clip(item.street),
			locality: clip(item.locality),
			region: clip(item.region),
			postalCode: clip(item.postalCode),
			country: clip(item.country),
		})),
		organization: clip(value.organization),
		organizationUnits: Array.isArray(value.organizationUnits)
			? value.organizationUnits.map(clip).slice(0, 20)
			: [],
		title: clip(value.title),
		birthday: clip(value.birthday),
		note: clip(value.note),
		url: clip(value.url),
		updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
		extra: Array.isArray(value.extra)
			? value.extra.map(keptLine).filter(Boolean).slice(0, 200)
			: [],
	};
}

/** An address book in memory, optionally persisted (see `createMemoryRecordStore`). */
export function createMemoryContactStore(options: MemoryStoreOptions<Contact> = {}): ContactStore {
	return createMemoryRecordStore({
		...options,
		key: options.key ?? 'ooxml-mail:contacts',
		sanitize: sanitizeContact,
	});
}
