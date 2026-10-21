// vCard 4.0 (RFC 6350) export for the address book: one card per contact, CRLF line ends, folded at
// 75 octets. Each edited field is escaped as its value type asks (text, the list components of `N`
// and `ADR`, a URI), and the lines `Contact.extra` keeps follow as read, an inline 3.0 or 2.1
// photo, logo, sound or key and a quoted-printable 2.1 value written as 4.0 has them
// (`vcard-legacy.ts`), so `vcard.ts` reads each card back as it was. New code.
import type { Contact } from './contacts';
import { vcard4Line } from './vcard-legacy';

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
