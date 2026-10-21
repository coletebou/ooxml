// vCard 3.0 and 2.1 lines the address book keeps as read, written for the vCard 4.0 the export
// declares. An inline binary PHOTO, LOGO, SOUND or KEY (`ENCODING=b;TYPE=JPEG` in 3.0,
// `ENCODING=BASE64` or a bare `JPEG;BASE64` in 2.1) becomes the `data:` URI (RFC 2397) that 4.0
// writes instead: 4.0 has no ENCODING parameter, and those properties are URIs there (RFC 6350
// sections 6.2.4, 6.6.3, 6.7.5 and 6.8.1). Used by `vcard-write.ts`. New code.
import { splitContentLine } from '../calendar/ics-lines';
import { parseLine } from './vcard-lines';

const BINARY = new Set(['PHOTO', 'LOGO', 'SOUND', 'KEY']);

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
 * group and its other parameters; any other line as it is.
 */
export function vcard4Line(line: string): string {
	const property = parseLine(line);
	const parts = splitContentLine(line);
	if (!property || !parts || !BINARY.has(property.name)) return line;
	const types = property.params.TYPE ?? [];
	const encoding = property.params.ENCODING?.[0]?.toUpperCase();
	const base64 = (type: string): boolean => type.toUpperCase() === 'BASE64';
	if (encoding !== 'B' && encoding !== 'BASE64' && !types.some(base64)) return line;
	const format = types.find((type) => !base64(type)) ?? '';
	// The type, the encoding and the value type go into the URI; a bare 2.1 parameter is one of them.
	const kept = parts.params.filter(
		(param) => param.includes('=') && !/^\s*(?:TYPE|ENCODING|VALUE)\s*=/i.test(param),
	);
	const data = property.value.replace(/\s+/g, '');
	return `${[parts.name, ...kept].join(';')}:data:${mediaType(property.name, format)};base64,${data}`;
}
