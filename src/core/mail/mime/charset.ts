// Character sets of MIME text (RFC 2045, RFC 2046 section 4.1.2, RFC 2047): labels normalised to
// the WHATWG Encoding names `TextDecoder` knows, a UTF-7 decoder (RFC 2152, which `TextDecoder`
// leaves out) and a fallback for unknown, missing or wrong labels. New code.
import { decodeBase64 } from '../../digest/base64';
import { trimChars } from './syntax';

const utf8Fatal = new TextDecoder('utf-8', { fatal: true });
const windows1252 = new TextDecoder('windows-1252');
const decoders = new Map<string, TextDecoder | null>();
const MAX_CACHED_DECODERS = 64;
const MAX_LABEL = 40;

/** Labels that say nothing about the text: read it as if no charset were given. */
const UNKNOWN = new Set([
	'',
	'unknown',
	'unknown-8bit',
	'x-unknown',
	'default',
	'none',
	'binary',
	'8bit',
	'x-user-defined',
]);
const ASCII = new Set([
	'us-ascii',
	'ascii',
	'us',
	'ansi_x3.4-1968',
	'iso646-us',
	'iso-ir-6',
	'csascii',
	'cp367',
	'ibm367',
	'7bit',
]);
/** Windows and IBM code page numbers mail programs write as `cp932`, `ms936` and so on. */
const CODE_PAGES: Readonly<Record<string, string>> = {
	'866': 'ibm866',
	'874': 'windows-874',
	'932': 'shift_jis',
	'936': 'gbk',
	'949': 'euc-kr',
	'950': 'big5',
};

/**
 * The name `decodeCharset` decodes `charset` as: the WHATWG label for the common mail aliases
 * (`cp1252`, `ms932`, `iso8859_15`, `latin-1`), `us-ascii` for the ASCII names, `utf-7`, and an
 * empty string for missing or meaningless labels. Quotes and an RFC 2231 `*language` are removed.
 */
export function normalizeCharset(charset: string | null | undefined): string {
	let label = trimChars((charset ?? '').trim(), `"'`).toLowerCase();
	const star = label.indexOf('*');
	if (star >= 0) label = label.slice(0, star);
	if (UNKNOWN.has(label)) return '';
	if (ASCII.has(label)) return 'us-ascii';
	if (/^(?:unicode-1-1-|x-)?utf-?7$/.test(label)) return 'utf-7';
	if (/^(?:unicode-1-1-)?utf[-_]?8$/.test(label)) return 'utf-8';
	const page = /^(?:cp|ms|win|windows|x-cp)[-_]?(\d{3,4})$/.exec(label)?.[1];
	if (page) return /^125\d$/.test(page) ? `windows-${page}` : (CODE_PAGES[page] ?? label);
	const part = /^iso[-_ ]?8859[-_ ]?(\d{1,2})$/.exec(label)?.[1];
	if (part) return `iso-8859-${Number(part)}`;
	if (label === 'latin-1' || label === 'iso-latin-1') return 'iso-8859-1';
	return label;
}

function decoderFor(label: string): TextDecoder | null {
	// Real labels are short; a long one from a hostile message must not sit in the cache.
	if (label.length > MAX_LABEL) return null;
	const cached = decoders.get(label);
	if (cached !== undefined) return cached;
	let decoder: TextDecoder | null;
	try {
		decoder = new TextDecoder(label);
	} catch {
		decoder = null;
	}
	if (decoders.size < MAX_CACHED_DECODERS) decoders.set(label, decoder);
	return decoder;
}

/**
 * Bytes whose charset is unknown, missing or claimed to be US-ASCII: UTF-8 when they are valid
 * UTF-8 (which plain ASCII is), else windows-1252, the usual source of stray 8-bit bytes.
 */
export function decodeUnlabelled(bytes: Uint8Array): string {
	try {
		return utf8Fatal.decode(bytes);
	} catch {
		return windows1252.decode(bytes);
	}
}

/** RFC 2152: `+` starts modified base64 of UTF-16 code units, `-` (absorbed) or any other end. */
function decodeUtf7(bytes: Uint8Array): string {
	return decodeUnlabelled(bytes).replace(/\+([A-Za-z0-9+/]*)-?/g, (match, run: string) => {
		if (!run) return match === '+-' ? '+' : match;
		const usable = run.length % 4 === 1 ? run.length - 1 : run.length;
		const units = decodeBase64(run.slice(0, usable)) ?? new Uint8Array(0);
		let out = '';
		for (let i = 0; i + 1 < units.length; i += 2)
			out += String.fromCharCode((units[i]! << 8) | units[i + 1]!);
		return out;
	});
}

/**
 * Decodes text bytes in `charset`, never throwing. Any label `TextDecoder` knows works (WHATWG
 * maps `iso-8859-1` and `us-ascii` to windows-1252, as browsers do), plus UTF-7. A missing, unknown
 * or unsupported charset, and `us-ascii` text with 8-bit bytes (common, against RFC 2045), read as
 * UTF-8 when valid, else windows-1252. Invalid UTF-8 in declared UTF-8 becomes U+FFFD.
 */
export function decodeCharset(bytes: Uint8Array, charset?: string | null): string {
	const label = normalizeCharset(charset);
	if (label === 'utf-7') return decodeUtf7(bytes);
	if (label === '' || label === 'us-ascii') return decodeUnlabelled(bytes);
	const decoder = decoderFor(label);
	return decoder ? decoder.decode(bytes) : decodeUnlabelled(bytes);
}
