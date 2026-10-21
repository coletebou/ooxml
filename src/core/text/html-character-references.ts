/**
 * HTML character references (`&eacute;`, `&#233;`, `&#xE9;`) decoded as the HTML Standard's
 * tokenizer reads them in an attribute value (its states from "Character reference state" to
 * "Numeric character reference end state"). DOM-free and format-neutral: for text taken out of
 * HTML, such as a mail preview or search.
 *
 * @module text/html-character-references
 */
import { NAMED_REFERENCES } from './html-named-references.generated';

interface References {
	/** What each name stands for, its semicolon left out. */
	named: ReadonlyMap<string, string>;
	/** The names a reader also takes without their semicolon. */
	bare: ReadonlySet<string>;
}

let references: References | undefined;

/** The named references, read from the table the first time one is looked up. */
function table(): References {
	if (references) return references;
	const named = new Map<string, string>();
	const bare = new Set<string>();
	for (const entry of NAMED_REFERENCES.trim().split(/\s+/)) {
		const [key = '', codes = ''] = entry.split(':');
		const name = key.endsWith('*') ? key.slice(0, -1) : key;
		if (name !== key) bare.add(name);
		named.set(name, String.fromCodePoint(...codes.split('.').map((code) => parseInt(code, 16))));
	}
	references = { named, bare };
	return references;
}

/**
 * What a numeric reference to 0x80 to 0x9F stands for (the Standard's table, windows-1252), by
 * the number less 0x80; 0 where it stays the control it names.
 */
const C1 = [
	0x20ac, 0, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0,
	0x17d, 0, 0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a,
	0x153, 0, 0x17e, 0x178,
];

/**
 * The character a numeric reference to `code` stands for, as the Standard's "Numeric character
 * reference end state" gives it.
 */
function numeric(code: number): string {
	// No character, a surrogate half or nothing Unicode has: the replacement character.
	if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\ufffd';
	return String.fromCodePoint((code >= 0x80 && code <= 0x9f && C1[code - 0x80]) || code);
}

/** A named reference or a numeric one, its semicolon perhaps missing. */
const REFERENCE = /&(?:([a-z][a-z0-9]{0,31})(;?)|#(?:x([0-9a-f]+)|(\d+));?)/gi;

/**
 * `text` with its character references decoded: every name HTML has (names are case-sensitive),
 * with its semicolon, or an older one without it (`&eacute`) unless a letter, a digit or `=`
 * follows; and numeric ones, with their semicolon or without it, as the Standard replaces them.
 * Anything else is left as written.
 */
export function decodeHtmlCharacterReferences(text: string): string {
	return text.replace(
		REFERENCE,
		(whole, name?: string, semicolon?: string, hex?: string, decimal?: string, at = 0) => {
			if (name === undefined)
				return numeric(hex === undefined ? Number(decimal) : parseInt(hex, 16));
			const { named, bare } = table();
			const legacy = !semicolon && bare.has(name) && text[at + whole.length] !== '=';
			return (semicolon || legacy ? named.get(name) : undefined) ?? whole;
		},
	);
}
