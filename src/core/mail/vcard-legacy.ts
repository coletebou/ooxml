// vCard 3.0 and 2.1 lines the address book keeps as read, written for the vCard 4.0 the export
// declares. An inline binary PHOTO, LOGO, SOUND or KEY (`ENCODING=b;TYPE=JPEG` in 3.0,
// `ENCODING=BASE64`, quoted-printable or a bare `JPEG;BASE64` in 2.1) becomes the `data:` URI
// (RFC 2397) that 4.0 writes instead: 4.0 has no ENCODING parameter, and those properties are URIs
// there (RFC 6350 sections 6.2.4, 6.6.3, 6.7.5 and 6.8.1). A GEO of two decimals (RFC 2426
// section 3.4.2) becomes the `geo:` URI of 4.0 (RFC 6350 section 6.5.2, RFC 5870), and a birthday
// or anniversary in the extended date and time format the basic one 4.0 takes (4.3). Any other
// quoted-printable value, an encoding 3.0 already dropped (RFC 2426 section 5), becomes the text it
// encodes. Used by `vcard-write.ts`. New code.
import { splitContentLine } from '../calendar/ics-lines';
import { encodeBase64 } from '../digest/base64';
import { decodeValue, isQuotedPrintable, parseLine, quotedPrintableBytes } from './vcard-lines';

const BINARY = new Set(['PHOTO', 'LOGO', 'SOUND', 'KEY']);
/** A 3.0 GEO, latitude then longitude (`37.386013;-122.082932`), or a 2.1 one with a comma. */
const DECIMAL_GEO = /^\s*\+?(-?\d+(?:\.\d+)?)\s*[;,]\s*\+?(-?\d+(?:\.\d+)?)\s*$/;

/** Legacy TYPE names whose media type is not `image/<name>` or `audio/<name>`. */
const NAMED: Readonly<Record<string, string>> = {
	jpg: 'image/jpeg',
	wave: 'audio/wav',
	x509: 'application/pkix-cert',
	pgp: 'application/pgp-keys',
};

/** The media type of a legacy TYPE value (`JPEG`, `image/png`, `X509`) of a binary property. */
function mediaType(property: string, type: string): string {
	const name = type.trim().toLowerCase();
	if (/^[a-z]+\/[\w.+-]+$/.test(name)) return name;
	const named = Object.hasOwn(NAMED, name) ? NAMED[name] : undefined;
	if (named) return named;
	if (/^[\w.+-]+$/.test(name)) {
		if (property === 'PHOTO' || property === 'LOGO') return `image/${name}`;
		if (property === 'SOUND') return `audio/${name}`;
	}
	return 'application/octet-stream';
}

/**
 * A vCard 2.1 value's text with its backslashes escaped as vCard 4.0 writes them (RFC 6350 3.4):
 * in 2.1 a backslash is itself, but before a semicolon, where both mean a semicolon.
 */
const escape21 = (text: string): string => text.replace(/\\(?!;)/g, '\\\\');

/**
 * A line a vCard 2.1 card kept (`Contact.extra`) in vCard 4.0 terms, its backslashes escaped
 * (`escape21`). A quoted-printable or inline binary one is left as read for `vcard4Line`, which
 * writes it as 4.0 from what it encodes.
 */
export function vcard21Line(line: string): string {
	const property = parseLine(line);
	const parts = splitContentLine(line);
	if (!property || !parts || isQuotedPrintable(property) || BINARY.has(property.name)) return line;
	return `${[parts.name, ...parts.params].join(';')}:${escape21(parts.value)}`;
}

/**
 * A 3.0 or 2.1 date and time in the extended format ISO 8601 also has (`1987-09-27T08:30:00-06:00`,
 * RFC 2426 3.1.5): its date, hour, minute, second and UTC offset.
 */
const EXTENDED_STAMP =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/** The same date and time in the basic format, the only one 4.0 takes (RFC 6350 4.3). */
function basicStamp(value: string): string | null {
	const match = EXTENDED_STAMP.exec(value.trim());
	if (!match) return null;
	const [, year, month, day, hour, minute, second, zone] = match;
	return `${year}${month}${day}T${hour}${minute}${second ?? ''}${(zone ?? '').replace(':', '')}`;
}

/** A 2.1 link's value type, `VALUE=URL`, as 4.0 names it: `uri` (RFC 6350 5.2). */
const uriValue = (param: string): string =>
	/^\s*VALUE\s*=\s*URL\s*$/i.test(param) ? 'VALUE=uri' : param;

/** A 2.1 encoding written alone, as 2.1 lets a parameter be (`;QUOTED-PRINTABLE`, `;8BIT`). */
const BARE_ENCODING = /^\s*(?:QUOTED-PRINTABLE|BASE64|8BIT|7BIT)\s*$/i;

/**
 * A line's parameters as 4.0 writes them, which are only `name=value` (RFC 6350 5.6): a type 2.1
 * writes alone (`;WORK`) as `TYPE=work`, an encoding written alone left out, and a link's value
 * type as `uri`.
 */
const params4 = (params: readonly string[]): string[] =>
	params.flatMap((param) => {
		if (param.includes('=')) return [uriValue(param)];
		return BARE_ENCODING.test(param) ? [] : [`TYPE=${param.trim().toLowerCase()}`];
	});

/**
 * A kept line as vCard 4.0 writes it: an inline binary value as a `data:` URI, with the line's
 * group and its other parameters; a GEO of two decimals as `geo:<latitude>,<longitude>`, so too;
 * a quoted-printable one as the text it encodes, a line break in it as `\n` (RFC 6350 3.4),
 * without the encoding and the charset (4.0 is UTF-8 alone, 3.1); a link's 2.1 value type, URL,
 * as `uri`; a birthday or anniversary in the extended date and time format in the basic one;
 * a type 2.1 writes alone as `TYPE=` (`params4`); any other line as it is.
 */
export function vcard4Line(line: string): string {
	const property = parseLine(line);
	const parts = splitContentLine(line);
	if (!property || !parts) return line;
	const geo = property.name === 'GEO' ? DECIMAL_GEO.exec(decodeValue(property)) : null;
	if (geo) {
		// The value is a URI now, which is what 4.0 takes it as: a VALUE that says float goes.
		const kept = params4(
			parts.params.filter((param) => !/^\s*(?:ENCODING|CHARSET|VALUE)\s*=/i.test(param)),
		);
		return `${[parts.name, ...kept].join(';')}:geo:${geo[1]},${geo[2]}`;
	}
	const dated =
		(property.name === 'BDAY' || property.name === 'ANNIVERSARY') &&
		property.params.VALUE?.[0]?.toLowerCase() !== 'text';
	const stamp = dated ? basicStamp(decodeValue(property)) : null;
	if (stamp) {
		// 4.0 reads it as date-and-or-time, its default: a 3.0 VALUE=date-time goes.
		const kept = params4(
			parts.params.filter((param) => !/^\s*(?:ENCODING|CHARSET|VALUE)\s*=/i.test(param)),
		);
		return `${[parts.name, ...kept].join(';')}:${stamp}`;
	}
	const quoted = isQuotedPrintable(property);
	const types = property.params.TYPE ?? [];
	const encoding = property.params.ENCODING?.[0]?.toUpperCase();
	const base64 = (type: string): boolean => type.toUpperCase() === 'BASE64';
	// A quoted-printable PHOTO is the image itself unless its value is a link (2.1 VALUE=URL).
	const link = /^(?:URL|URI|CID|CONTENT-ID)$/i.test(property.params.VALUE?.[0] ?? '');
	const inline =
		BINARY.has(property.name) &&
		(encoding === 'B' || encoding === 'BASE64' || types.some(base64) || (quoted && !link));
	if (!inline) {
		const params = params4(parts.params);
		if (!quoted)
			return params.join(';') !== parts.params.join(';')
				? `${[parts.name, ...params].join(';')}:${parts.value}`
				: line;
		// The encoding and the charset go (`params4` drops a bare `;QUOTED-PRINTABLE`); the text is 2.1's.
		const kept = params.filter((param) => !/^\s*(?:ENCODING|CHARSET)\s*=/i.test(param));
		const text = escape21(decodeValue(property)).replace(/\r\n|\r|\n/g, '\\n');
		return `${[parts.name, ...kept].join(';')}:${text}`;
	}
	const format = types.find((type) => !base64(type)) ?? '';
	// The type, the encoding and the value type go into the URI; a bare 2.1 parameter is one of them.
	const kept = parts.params.filter(
		(param) => param.includes('=') && !/^\s*(?:TYPE|ENCODING|VALUE|CHARSET)\s*=/i.test(param),
	);
	const data = quoted
		? encodeBase64(quotedPrintableBytes(property.value))
		: property.value.replace(/\s+/g, '');
	return `${[parts.name, ...kept].join(';')}:data:${mediaType(property.name, format)};base64,${data}`;
}
