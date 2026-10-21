// vCard content lines (RFC 6350 section 3.3): unfolding, the name, parameters and value of each
// line, structured-value splitting and text unescaping, and the 2.1 quoted-printable values. Used
// by `vcard.ts`. The line split and the RFC 6868 decoding are the iCalendar reader's, which shares
// the line format; the rest stays vCard's own (group prefixes, bare 2.1 types, quoted-printable
// soft breaks, only the escapes RFC 6350 defines). New code.
import { caretDecode, splitContentLine } from '../calendar/ics-lines';

export interface Property {
	name: string;
	params: Record<string, string[]>;
	value: string;
	/** The unfolded line as read, for properties kept verbatim. */
	raw: string;
}

/** Whether a property's value is quoted-printable (`ENCODING=QUOTED-PRINTABLE`, vCard 2.1). */
export const isQuotedPrintable = (property: Property): boolean =>
	property.params.ENCODING?.[0]?.toUpperCase() === 'QUOTED-PRINTABLE';

/** Versions that fold with a space after any character, an `=` included (RFC 6350 3.2). */
const FOLD_ANYWHERE = new Set(['3.0', '4.0']);
/** A line that begins or ends a card, which no value runs on into. */
const CARD_EDGE = /^(?:BEGIN|END):VCARD\s*$/i;

/**
 * Join folded lines (CRLF or LF followed by a space or tab, which goes) and quoted-printable soft
 * breaks. An `=` that ends a line of a quoted-printable value is a soft break (RFC 2045 6.7, rule
 * 5): the `=` goes and the next line follows as it is, leading white space included, as vCard 2.1
 * writes it. A card that says it is 3.0 or 4.0 folds with a space after any character, so there a
 * next line that starts with one is a fold. Whether a value is quoted-printable is read from its
 * parameters, once per property, never from its text.
 */
export function unfold(text: string): string[] {
	// A byte order mark (files saved by some editors) would otherwise hide the first BEGIN line.
	const lines = text
		.replace(/^\uFEFF/u, '')
		.replace(/\r\n?/g, '\n')
		.split('\n');
	const out: string[] = [];
	/** The VERSION of the card being read, empty until it says. */
	let version = '';
	let quoted = false;
	let soft = false;
	for (const line of lines) {
		const last = out.length - 1;
		const folded = line.startsWith(' ') || line.startsWith('\t');
		if (soft && (!folded || !FOLD_ANYWHERE.has(version)) && !CARD_EDGE.test(line))
			out[last] = out[last]!.slice(0, -1) + line;
		else if (folded && last >= 0) out[last] += line.slice(1);
		else {
			const property = parseLine(line);
			if (property?.name === 'VERSION') version = property.value.trim();
			else if (property?.name === 'BEGIN') version = '';
			quoted = property !== null && isQuotedPrintable(property);
			out.push(line);
		}
		soft = quoted && line.endsWith('=');
	}
	return out.filter((line) => line.trim() !== '');
}

/** One unfolded line as a property, or null when it has no colon outside quotes or no name. */
export function parseLine(line: string): Property | null {
	const parts = splitContentLine(line);
	if (!parts) return null;
	// A group prefix (`item1.TEL`) is dropped.
	const name = parts.name.replace(/^[^.]*\./, '').toUpperCase();
	if (!name) return null;
	const params: Record<string, string[]> = {};
	for (const part of parts.params) {
		const eq = part.indexOf('=');
		// vCard 2.1 writes bare types: `TEL;WORK;VOICE:...`.
		const key = (eq < 0 ? 'TYPE' : part.slice(0, eq)).toUpperCase();
		const raw = eq < 0 ? part : part.slice(eq + 1);
		const values = raw.match(/"[^"]*"|[^,]+/g) ?? [];
		params[key] = [
			...(params[key] ?? []),
			...values.map((v) => caretDecode(v.replace(/^"|"$/g, ''))),
		];
	}
	return { name, params, value: parts.value, raw: line };
}

/** Split on separators not escaped with a backslash. */
export function splitUnescaped(value: string, separator: ';' | ','): string[] {
	const out: string[] = [];
	let current = '';
	for (let i = 0; i < value.length; i++) {
		const char = value[i]!;
		if (char === '\\' && i + 1 < value.length) {
			current += char + value[i + 1];
			i++;
		} else if (char === separator) {
			out.push(current);
			current = '';
		} else current += char;
	}
	out.push(current);
	return out;
}

/**
 * A TEXT value: `\n` (or `\N`) is a line break, `\\`, `\,` and `\;` their character. Unlike
 * iCalendar's `unescapeText`, any other backslash is kept as written.
 */
export const unescapeText = (value: string): string =>
	value.replace(/\\([\\,;nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));

/** The bytes of a quoted-printable value: `=XX` is that byte, any other character its own. */
export function quotedPrintableBytes(text: string): Uint8Array {
	const bytes: number[] = [];
	for (let i = 0; i < text.length; i++) {
		const hex = text.slice(i + 1, i + 3);
		if (text[i] === '=' && /^[0-9A-F]{2}$/i.test(hex)) {
			bytes.push(Number.parseInt(hex, 16));
			i += 2;
		} else bytes.push(text.charCodeAt(i) & 0xff);
	}
	return new Uint8Array(bytes);
}

export function decodeValue(property: Property): string {
	if (!isQuotedPrintable(property)) return property.value;
	const bytes = quotedPrintableBytes(property.value);
	const charset = property.params.CHARSET?.[0] ?? 'utf-8';
	try {
		return new TextDecoder(charset).decode(bytes);
	} catch {
		return new TextDecoder('utf-8').decode(bytes);
	}
}
