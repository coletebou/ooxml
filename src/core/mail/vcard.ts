// vCard (RFC 6350) import and export for the address book. Reads vCard 4.0, 3.0 and the common 2.1
// forms (bare TYPE parameters, quoted-printable values); `vcard-write.ts` writes 4.0. Properties
// the contact model does not edit, and a second website, note, title, organization or name of a
// card, are kept verbatim in `Contact.extra`, so an import then export keeps them (an inline 3.0 or
// 2.1 photo, logo, sound or key and a quoted-printable 2.1 value written as 4.0 has them,
// `vcard-legacy.ts`). New code.
import { sha256 } from '../digest/sha256';
import { emptyContact, type Contact, type ContactAddress, type ContactLists } from './contacts';
import {
	decodeValue,
	parseLine,
	splitUnescaped,
	unescapeText,
	unfold,
	type Property,
} from './vcard-lines';

export { serializeVCards } from './vcard-write';

/**
 * The components of `parts` a card gave several values (`Line 1,Line 2`), each list unescaped;
 * their values joined by commas are the text `unescapeText` gives the component.
 */
function listsOf<K extends string>(parts: Record<K, string>): ContactLists<K> | null {
	const out: Partial<Record<K, string[]>> = {};
	for (const key of Object.keys(parts) as K[]) {
		const values = splitUnescaped(parts[key], ',');
		if (values.length > 1) out[key] = values.map(unescapeText);
	}
	return Object.keys(out).length ? out : null;
}

const KNOWN_TYPES = new Set(['home', 'work', 'cell', 'fax', 'other', 'pager']);
/** TYPE values that mark what a value is (a voice line, a preferred one), never its label. */
const MARKERS = new Set(['voice', 'text', 'pref', 'internet']);
/**
 * The first meaningful TYPE value, lower case: a mobile number is `cell`, then a label the form
 * offers (`work`, `home`, ...), then the card's own (`video`, `x-school`), which the form keeps.
 */
function typeOf(property: Property, fallback = ''): string {
	const types = (property.params.TYPE ?? [])
		.flatMap((t) => t.split(','))
		.map((t) => t.trim().toLowerCase());
	const cell = types.includes('cell') || types.includes('mobile') ? 'cell' : '';
	const known = types.find((type) => KNOWN_TYPES.has(type));
	const own = types.find((type) => /^[a-z\d-]+$/.test(type) && !MARKERS.has(type));
	return cell || known || own || fallback;
}

/**
 * `19850412`, `1985-04-12`, `--0412` and `--04-12` as `YYYY-MM-DD` or `--MM-DD`; a date-time at
 * midnight, as some programs write a date, is its date. Any other time is not a date.
 */
function normaliseDate(value: string): string | null {
	const full = /^(\d{4})-?(\d{2})-?(\d{2})(?:T00:?00(?::?00)?Z?)?$/.exec(value);
	if (full) return `${full[1]}-${full[2]}-${full[3]}`;
	const noYear = /^--(\d{2})-?(\d{2})$/.exec(value);
	return noYear ? `--${noYear[1]}-${noYear[2]}` : null;
}

/** A `REV` timestamp (RFC 6350 6.7.4) as epoch ms: UTC, or local time with its UTC offset. */
function parseRev(value: string): number | undefined {
	const match =
		/^(\d{4})-?(\d{2})-?(\d{2})(?:T(\d{2}):?(\d{2})(?::?(\d{2}))?(Z|([+-])(\d{2}):?(\d{2})?)?)?$/.exec(
			value.trim(),
		);
	if (!match) return undefined;
	const [, y, mo, d, h = '0', mi = '0', s = '0', , sign, oh = '0', om = '0'] = match;
	const at = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
	const offset = sign ? (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om)) * 60_000 : 0;
	return Number.isNaN(at) ? undefined : at - offset;
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
	 * Whether this property fills its field: FN, N, ORG, TITLE, NOTE and URL may each appear any
	 * number of times (RFC 6350 sections 6.2.1, 6.2.2 with ALTID, 6.6.1, 6.6.4, 6.7.2 and 6.7.8), and
	 * the contact holds one of each. The first that says something fills it; every later one is kept
	 * as read, after the field on export, so it reads back the same. One that says nothing is not
	 * kept.
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
				const components = splitUnescaped(value, ';');
				// A second N (another script's spelling, `ALTID`) is kept as read, as with FN.
				if (
					!fills(
						property,
						components.some((c) => unescapeText(c).trim() !== ''),
					)
				)
					break;
				const [familyName = '', givenName = '', additional = '', prefix = '', suffix = ''] =
					components;
				Object.assign(contact, {
					familyName: unescapeText(familyName),
					givenName: unescapeText(givenName),
					additionalNames: unescapeText(additional),
					prefix: unescapeText(prefix),
					suffix: unescapeText(suffix),
				});
				const lists = listsOf({ familyName, givenName });
				if (lists) contact.lists = lists;
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
				] = splitUnescaped(value, ';');
				const parts = { poBox, extended, street, locality, region, postalCode, country };
				const lists = listsOf(parts);
				addresses.push({
					type: typeOf(property),
					...(Object.fromEntries(
						Object.entries(parts).map(([part, text]) => [part, unescapeText(text)]),
					) as typeof parts),
					...(lists ? { lists } : {}),
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
