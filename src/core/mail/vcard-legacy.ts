// vCard 3.0 and 2.1 lines the address book keeps as read, written for the vCard 4.0 the export
// declares. An inline binary PHOTO, LOGO, SOUND or KEY (`ENCODING=b;TYPE=JPEG` in 3.0,
// `ENCODING=BASE64`, quoted-printable or a bare `JPEG;BASE64` in 2.1) becomes the `data:` URI
// (RFC 2397) that 4.0 writes instead: 4.0 has no ENCODING parameter, and those properties are URIs
// there (RFC 6350 sections 6.2.4, 6.6.3, 6.7.5 and 6.8.1). A GEO of two decimals (RFC 2426
// section 3.4.2) becomes the `geo:` URI of 4.0 (RFC 6350 section 6.5.2, RFC 5870). Any other
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
 * A kept line as vCard 4.0 writes it: an inline binary value as a `data:` URI, with the line's
 * group and its other parameters; a GEO of two decimals as `geo:<latitude>,<longitude>`, so too;
 * a quoted-printable one as the text it encodes, a line break in it as `\n` (RFC 6350 3.4),
 * without the encoding and the charset (4.0 is UTF-8 alone, 3.1); any other line as it is.
 */
export function vcard4Line(line: string): string {
	const property = parseLine(line);
	const parts = splitContentLine(line);
	if (!property || !parts) return line;
	const geo = property.name === 'GEO' ? DECIMAL_GEO.exec(decodeValue(property)) : null;
	if (geo) {
		// The value is a URI now, which is what 4.0 takes it as: a VALUE that says float goes.
		const kept = parts.params.filter((param) => !/^\s*(?:ENCODING|CHARSET|VALUE)\s*=/i.test(param));
		return `${[parts.name, ...kept].join(';')}:geo:${geo[1]},${geo[2]}`;
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
		if (!quoted) return line;
		const kept = parts.params.filter((param) => !/^\s*(?:ENCODING|CHARSET)\s*=/i.test(param));
		const text = decodeValue(property).replace(/\r\n|\r|\n/g, '\\n');
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
