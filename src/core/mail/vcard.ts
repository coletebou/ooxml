// vCard (RFC 6350) import and export for the address book. Reads vCard 4.0, 3.0 and the common
// 2.1 forms (bare TYPE parameters, quoted-printable values), writes 4.0. Properties the contact
// model does not edit are kept verbatim in `Contact.extra`, so an import then export keeps them.
// New code.
import { emptyContact, type Contact, type ContactAddress } from './contacts';
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

/** A small stable hash, for ids of cards that have no UID. */
function hash(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
	return (h >>> 0).toString(36);
}

const SKIP = new Set(['BEGIN', 'END', 'VERSION', 'PRODID']);

function toContact(properties: Property[], fallbackId: string): Contact {
	const contact: { -readonly [K in keyof Contact]: Contact[K] } = emptyContact(fallbackId, 0);
	const emails: Contact['emails'][number][] = [];
	const phones: Contact['phones'][number][] = [];
	const addresses: ContactAddress[] = [];
	const extra: string[] = [];
	for (const property of properties) {
		const value = decodeValue(property);
		const text = unescapeText(value);
		switch (property.name) {
			case 'FN':
				contact.name = text;
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
				contact.organization = name;
				contact.organizationUnits = units.filter(Boolean);
				break;
			}
			case 'TITLE':
				contact.title = text;
				break;
			case 'NOTE':
				contact.note = text;
				break;
			case 'URL':
				contact.url = text;
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
 * Every card in a `.vcf` file. Cards without a `UID` get an id derived from their text; lines
 * outside a card and cards without `END:VCARD` are counted in `skipped`, never silently lost.
 */
export function parseVCards(text: string): { contacts: Contact[]; skipped: number } {
	const contacts: Contact[] = [];
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
			if (card) contacts.push(toContact(card, `vcard-${contacts.length}-${hash(cardText)}`));
			else skipped++;
			card = null;
		} else if (card) {
			card.push(property);
			cardText += `${line}\n`;
		} else skipped++;
	}
	if (card) skipped++;
	return { contacts, skipped };
}

const escapeText = (value: string): string =>
	value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
/**
 * A component of a structured value (`N`, `ADR`, `ORG`). Commas stay unescaped there: they separate
 * the values of one component (`ing. jr,M.Sc.`), so a list read in is written back as a list.
 */
const escapeComponent = (value: string): string =>
	value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;');

const encoder = new TextEncoder();
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

const typeParam = (type: string): string => (type ? `;TYPE=${type}` : '');

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
		lines.push('BEGIN:VCARD', 'VERSION:4.0', `UID:${escapeText(contact.id)}`);
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
				`ORG:${[contact.organization, ...contact.organizationUnits].map(escapeComponent).join(';')}`,
			);
		if (contact.title) lines.push(`TITLE:${escapeText(contact.title)}`);
		if (contact.birthday)
			lines.push(
				`BDAY:${contact.birthday.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1$2$3').replace(/^--(\d{2})-(\d{2})$/, '--$1$2')}`,
			);
		if (contact.url) lines.push(`URL:${escapeText(contact.url)}`);
		if (contact.note) lines.push(`NOTE:${escapeText(contact.note)}`);
		if (contact.updatedAt) lines.push(`REV:${formatRev(contact.updatedAt)}`);
		lines.push(...contact.extra, 'END:VCARD');
	}
	return lines.map(foldLine).join('\r\n') + (lines.length ? '\r\n' : '');
}
