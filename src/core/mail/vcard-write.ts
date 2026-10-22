// vCard 4.0 (RFC 6350) export for the address book: one card per contact, CRLF line ends, folded at
// 75 octets. Each edited field is escaped as its value type asks (text, the lists of `N`, a URI),
// and the lines `Contact.extra` keeps follow as read, an inline 3.0 or 2.1 photo, logo, sound or
// key and a quoted-printable 2.1 value written as 4.0 has them (`vcard-legacy.ts`), so `vcard.ts`
// reads each card back as it was. New code.
import { ADDRESS_PARTS, type Contact } from './contacts';
import { vcard4Line } from './vcard-legacy';
import { parseLine } from './vcard-lines';

const encoder = new TextEncoder();

/**
 * Backslashes and line breaks escaped (RFC 6350 3.4). A lone CR, which quoted-printable `=0D`
 * gives, is a line break too: written as it is, it would end the line for any reader.
 */
const escapeBreaks = (value: string): string =>
	value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n');
const escapeText = (value: string): string =>
	escapeBreaks(value).replace(/,/g, '\\,').replace(/;/g, '\\;');
/**
 * The additional names, honorific prefixes or suffixes of `N`, which the contact keeps as the
 * comma-separated list vCard writes (RFC 6350 `list-component`, `ing. jr,M.Sc.`): their commas stay
 * unescaped, so a list read in is written back as a list. Every other component of `N` and `ADR`,
 * like an `ORG` one, is a single text the form edits as typed, and is escaped as text: a comma in
 * `12 Main St, Unit 2` is the character, never the start of a second street.
 */
const escapeList = (value: string): string => escapeBreaks(value).replace(/;/g, '\\;');
/**
 * A component kept as one text, escaped as text, or, while it is still the text of the values a
 * card gave it (`ContactLists`), those values as a list again.
 */
const escapePart = (value: string, values: readonly string[] | undefined): string =>
	values && values.join(',') === value ? values.map(escapeText).join(',') : escapeText(value);
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

/** The ALTID parameter a regenerated N or BDAY keeps (`Contact.altIds`), when it is a plain name. */
const altParam = (contact: Contact, name: 'N' | 'BDAY'): string => {
	const altId = contact.altIds?.[name];
	return altId && /^[\w.-]{1,64}$/.test(altId) ? `;ALTID=${altId}` : '';
};

/**
 * The kept lines a contact writes after its fields. A BDAY kept as read (a text or a birth time)
 * goes once the contact has a birthday of its own, unless it is an alternative of that one (the
 * same ALTID): vCard holds one birthday, so a date typed in takes its place.
 */
function keptLines(contact: Contact): string[] {
	if (!contact.birthday) return contact.extra.map(vcard4Line);
	const altId = contact.altIds?.BDAY;
	return contact.extra
		.filter((line) => {
			const property = parseLine(line);
			if (property?.name !== 'BDAY') return true;
			return !!altId && property.params.ALTID?.[0] === altId;
		})
		.map(vcard4Line);
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
			escapePart(contact.familyName, contact.lists?.familyName),
			escapePart(contact.givenName, contact.lists?.givenName),
			escapeList(contact.additionalNames),
			escapeList(contact.prefix),
			escapeList(contact.suffix),
		];
		if (name.some(Boolean)) lines.push(`N${altParam(contact, 'N')}:${name.join(';')}`);
		for (const email of contact.emails)
			lines.push(`EMAIL${typeParam(email.type)}:${escapeText(email.address)}`);
		for (const phone of contact.phones)
			lines.push(`TEL${typeParam(phone.type)}:${escapeText(phone.number)}`);
		for (const address of contact.addresses) {
			const parts = ADDRESS_PARTS.map((part) => escapePart(address[part], address.lists?.[part]));
			lines.push(`ADR${typeParam(address.type)}:${parts.join(';')}`);
		}
		if (contact.organization || contact.organizationUnits.length)
			lines.push(
				`ORG:${[contact.organization, ...contact.organizationUnits].map(escapeText).join(';')}`,
			);
		if (contact.title) lines.push(`TITLE:${escapeText(contact.title)}`);
		if (contact.birthday)
			lines.push(
				birthdayLine(contact.birthday).replace(/^BDAY/, `BDAY${altParam(contact, 'BDAY')}`),
			);
		if (contact.url) lines.push(`URL:${escapeUri(contact.url)}`);
		if (contact.note) lines.push(`NOTE:${escapeText(contact.note)}`);
		if (contact.updatedAt) lines.push(`REV:${formatRev(contact.updatedAt)}`);
		lines.push(...keptLines(contact), 'END:VCARD');
	}
	return lines.map(foldLine).join('\r\n') + (lines.length ? '\r\n' : '');
}
