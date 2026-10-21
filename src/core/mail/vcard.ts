// vCard (RFC 6350) import and export for the address book. Reads vCard 4.0, 3.0 and the common
// 2.1 forms (bare TYPE parameters, quoted-printable values), writes 4.0. Properties the contact
// model does not edit, and a second website, note, title, organization or name of a card, are kept
// verbatim in `Contact.extra`, so an import then export keeps them (an inline 3.0 or 2.1 photo,
// logo, sound or key written as 4.0 has it, `vcard-legacy.ts`).
// New code.
import { sha256 } from '../digest/sha256';
import { emptyContact, type Contact, type ContactAddress } from './contacts';
import { vcard4Line } from './vcard-legacy';
import {
	decodeValue,
	parseLine,
	splitUnescaped,
	unescapeText,
	unfold,
	type Property,
} from './vcard-lines';

const KNOWN_TYPES = new Set(['home', 'work', 'cell', 'fax', 'other', 'pager', 'voice', 'text']);
/** The first meaningful TYPE value (`work`, `home`, `cell`, ...), lower case. */
function typeOf(property: Property, fallback = ''): string {
	const types = (property.params.TYPE ?? [])
		.flatMap((t) => t.split(','))
		.map((t) => t.toLowerCase());
	const cell = types.includes('cell') || types.includes('mobile') ? 'cell' : '';
	const known = types.find((type) => KNOWN_TYPES.has(type) && type !== 'voice' && type !== 'text');
	return cell || known || fallback;
}

/** `19850412`, `1985-04-12`, `--0412` and `--04-12` as `YYYY-MM-DD` or `--MM-DD`. */
function normaliseDate(value: string): string | null {
	const full = /^(\d{4})-?(\d{2})-?(\d{2})(?:T.*)?$/.exec(value);
	if (full) return `${full[1]}-${full[2]}-${full[3]}`;
	const noYear = /^--(\d{2})-?(\d{2})$/.exec(value);
	return noYear ? `--${noYear[1]}-${noYear[2]}` : null;
}

function parseRev(value: string): number | undefined {
	const match = /^(\d{4})-?(\d{2})-?(\d{2})(?:T(\d{2}):?(\d{2}):?(\d{2})?Z?)?/.exec(value);
	if (!match) return undefined;
	const [, y, mo, d, h = '0', mi = '0', s = '0'] = match;
	const at = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
	return Number.isNaN(at) ? undefined : at;
}

const encoder = new TextEncoder();

/**
 * The id of a card without a UID, from its unfolded lines alone: the card is the same contact
 * wherever it stands in a file, and in any file that holds it. 64 bits of SHA-256, so two different
 * cards do not meet by chance in any address book.
 */
function contentId(card: string): string {
	const digest = sha256(encoder.encode(card)).subarray(0, 8);
	return `vcard-${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

const SKIP = new Set(['BEGIN', 'END', 'VERSION', 'PRODID']);

function toContact(properties: Property[], fallbackId: string): Contact {
	const contact: { -readonly [K in keyof Contact]: Contact[K] } = emptyContact(fallbackId, 0);
	const emails: Contact['emails'][number][] = [];
	const phones: Contact['phones'][number][] = [];
	const addresses: ContactAddress[] = [];
	const extra: string[] = [];
	const filled = new Set<string>();
	/**
	 * Whether this property fills its field: FN, ORG, TITLE, NOTE and URL may each appear any number
	 * of times (RFC 6350 sections 6.2.1, 6.6.1, 6.6.4, 6.7.2 and 6.7.8), and the contact holds one of
	 * each. The first that says something fills it; every later one is kept as read, after the field
	 * on export, so it reads back the same. One that says nothing is not kept.
	 */
	const fills = (property: Property, says: boolean): boolean => {
		if (filled.has(property.name)) {
			extra.push(property.raw);
			return false;
		}
		if (says) filled.add(property.name);
		return says;
	};
	for (const property of properties) {
		const value = decodeValue(property);
		const text = unescapeText(value);
		switch (property.name) {
			case 'FN':
				if (fills(property, text.trim() !== '')) contact.name = text;
				break;
			case 'N': {
				const [family = '', given = '', additional = '', prefix = '', suffix = ''] = splitUnescaped(
					value,
					';',
				).map(unescapeText);
				Object.assign(contact, {
					familyName: family,
					givenName: given,
					additionalNames: additional,
					prefix,
					suffix,
				});
				break;
			}
			case 'EMAIL':
				if (text.trim()) emails.push({ type: typeOf(property), address: text.trim() });
				break;
			case 'TEL':
				if (text.trim())
					phones.push({ type: typeOf(property), number: text.replace(/^tel:/i, '').trim() });
				break;
			case 'ADR': {
				const [
					poBox = '',
					extended = '',
					street = '',
					locality = '',
					region = '',
					postalCode = '',
					country = '',
				] = splitUnescaped(value, ';').map(unescapeText);
				addresses.push({
					type: typeOf(property),
					poBox,
					extended,
					street,
					locality,
					region,
					postalCode,
					country,
				});
				break;
			}
			case 'ORG': {
				const [name = '', ...units] = splitUnescaped(value, ';').map(unescapeText);
				const says = [name, ...units].some((part) => part.trim() !== '');
				if (fills(property, says)) {
					contact.organization = name;
					contact.organizationUnits = units.filter(Boolean);
				}
				break;
			}
			case 'TITLE':
				if (fills(property, text.trim() !== '')) contact.title = text;
				break;
			case 'NOTE':
				if (fills(property, text.trim() !== '')) contact.note = text;
				break;
			case 'URL':
				if (fills(property, text.trim() !== '')) contact.url = text;
				break;
			case 'UID':
				if (text.trim()) contact.id = text.trim();
				break;
			case 'REV':
				contact.updatedAt = parseRev(text) ?? 0;
				break;
			case 'BDAY': {
				const date = normaliseDate(text.trim());
				if (date) contact.birthday = date;
				else extra.push(property.raw);
				break;
			}
			default:
				if (!SKIP.has(property.name)) extra.push(property.raw);
		}
	}
	return { ...contact, emails, phones, addresses, extra };
}

/**
 * Every card in a `.vcf` file. Cards without a `UID` get an id derived from their text, and two
 * copies of one such card are one contact; lines outside a card and cards without `END:VCARD` are
 * counted in `skipped`, never silently lost.
 */
export function parseVCards(text: string): { contacts: Contact[]; skipped: number } {
	const contacts: Contact[] = [];
	const copies = new Set<string>();
	let skipped = 0;
	let card: Property[] | null = null;
	let cardText = '';
	for (const line of unfold(text)) {
		const property = parseLine(line);
		if (!property) {
			skipped += card ? 0 : 1;
			continue;
		}
		if (property.name === 'BEGIN' && property.value.trim().toUpperCase() === 'VCARD') {
			if (card) skipped++;
			card = [];
			cardText = '';
		} else if (property.name === 'END' && property.value.trim().toUpperCase() === 'VCARD') {
			if (!card) skipped++;
			else {
				const id = contentId(cardText);
				const contact = toContact(card, id);
				// A second copy of a card without a UID is the contact the first one gave.
				if (contact.id !== id || !copies.has(id)) contacts.push(contact);
				copies.add(id);
			}
			card = null;
		} else if (card) {
			card.push(property);
			cardText += `${line}\n`;
		} else skipped++;
	}
	if (card) skipped++;
	return { contacts, skipped };
}

/**
 * Backslashes and line breaks escaped (RFC 6350 3.4). A lone CR, which quoted-printable `=0D`
 * gives, is a line break too: written as it is, it would end the line for any reader.
 */
const escapeBreaks = (value: string): string =>
	value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n');
const escapeText = (value: string): string =>
	escapeBreaks(value).replace(/,/g, '\\,').replace(/;/g, '\\;');
/**
 * A component of `N` or `ADR`. Commas stay unescaped there: those components are lists (RFC 6350
 * `list-component`), their values separated by commas (`ing. jr,M.Sc.`), so a list read in is
 * written back as a list. An `ORG` component is a single value and is escaped as text.
 */
const escapeComponent = (value: string): string => escapeBreaks(value).replace(/;/g, '\\;');
/**
 * A URI value (`URL`, RFC 6350 6.7.8), not escaped as text: other readers keep such escapes in the
 * link. A URI holds no line break (dropped) and no backslash (percent-encoded, never an escape).
 */
const escapeUri = (value: string): string => value.replace(/[\r\n]/g, '').replace(/\\/g, '%5C');

/** Fold at 75 octets (RFC 6350 3.2), never inside a UTF-8 sequence. */
function foldLine(line: string): string {
	if (encoder.encode(line).length <= 75) return line;
	const out: string[] = [];
	let current = '';
	let size = 0;
	for (const char of line) {
		const width = encoder.encode(char).length;
		const limit = out.length ? 74 : 75;
		if (size + width > limit) {
			out.push(current);
			current = '';
			size = 0;
		}
		current += char;
		size += width;
	}
	out.push(current);
	return out.join('\r\n ');
}

/** A TYPE parameter for a type that is a name (`work`, `x-desk`); anything else is left out. */
const typeParam = (type: string): string => (/^[a-z\d-]+$/i.test(type) ? `;TYPE=${type}` : '');

/** `BDAY` as a date (`19850412`, `--0412`), else as text (`VALUE=text`, RFC 6350 6.2.5). */
function birthdayLine(birthday: string): string {
	const date = birthday
		.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1$2$3')
		.replace(/^--(\d{2})-(\d{2})$/, '--$1$2');
	return /^(?:\d{8}|--\d{4})$/.test(date)
		? `BDAY:${date}`
		: `BDAY;VALUE=text:${escapeText(birthday)}`;
}

/** A URI (RFC 3986: a scheme and a colon), printable ASCII without spaces or backslashes. */
const URI = /^[a-z][a-z\d+.-]*:[\x21-\x5b\x5d-\x7e]+$/i;
/** A `UID` is a URI unless marked as text (RFC 6350 6.7.6), and a bare id such as a UUID is not. */
const uidLine = (id: string): string =>
	URI.test(id) ? `UID:${id}` : `UID;VALUE=text:${escapeText(id)}`;

function formatRev(ms: number): string {
	return new Date(ms)
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}/, '');
}

/** One vCard 4.0 per contact, CRLF line ends, folded. */
export function serializeVCards(contacts: readonly Contact[]): string {
	const lines: string[] = [];
	for (const contact of contacts) {
		lines.push('BEGIN:VCARD', 'VERSION:4.0', uidLine(contact.id));
		lines.push(
			`FN:${escapeText(contact.name || [contact.givenName, contact.familyName].filter(Boolean).join(' '))}`,
		);
		const name = [
			contact.familyName,
			contact.givenName,
			contact.additionalNames,
			contact.prefix,
			contact.suffix,
		];
		if (name.some(Boolean)) lines.push(`N:${name.map(escapeComponent).join(';')}`);
		for (const email of contact.emails)
			lines.push(`EMAIL${typeParam(email.type)}:${escapeText(email.address)}`);
		for (const phone of contact.phones)
			lines.push(`TEL${typeParam(phone.type)}:${escapeText(phone.number)}`);
		for (const address of contact.addresses) {
			const parts = [
				address.poBox,
				address.extended,
				address.street,
				address.locality,
				address.region,
				address.postalCode,
				address.country,
			];
			lines.push(`ADR${typeParam(address.type)}:${parts.map(escapeComponent).join(';')}`);
		}
		if (contact.organization || contact.organizationUnits.length)
			lines.push(
				`ORG:${[contact.organization, ...contact.organizationUnits].map(escapeText).join(';')}`,
			);
		if (contact.title) lines.push(`TITLE:${escapeText(contact.title)}`);
		if (contact.birthday) lines.push(birthdayLine(contact.birthday));
		if (contact.url) lines.push(`URL:${escapeUri(contact.url)}`);
		if (contact.note) lines.push(`NOTE:${escapeText(contact.note)}`);
		if (contact.updatedAt) lines.push(`REV:${formatRev(contact.updatedAt)}`);
		lines.push(...contact.extra.map(vcard4Line), 'END:VCARD');
	}
	return lines.map(foldLine).join('\r\n') + (lines.length ? '\r\n' : '');
}
