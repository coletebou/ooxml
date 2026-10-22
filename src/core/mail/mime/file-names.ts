// File names: the name a received part is saved under, cleaned of directories and of characters
// that disguise it, the extension of a media type, and file names safe on every desktop system.
// New code.
import { trimChars } from './syntax';

const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;
/** Bidirectional formatting characters, which can make `exe.pdf` show as `fdp.exe`. */
const BIDI = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
/** Characters Windows forbids in file names; macOS forbids `:` and `/` among them. */
const INVALID = /[<>:"/\\|?*]/g;
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

const EXTENSIONS: Readonly<Record<string, string>> = {
	'application/json': 'json',
	'application/pdf': 'pdf',
	'application/zip': 'zip',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
	'audio/mpeg': 'mp3',
	'image/bmp': 'bmp',
	'image/gif': 'gif',
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/svg+xml': 'svg',
	'image/tiff': 'tif',
	'image/webp': 'webp',
	'message/global': 'eml',
	'message/rfc822': 'eml',
	'text/calendar': 'ics',
	'text/csv': 'csv',
	'text/html': 'html',
	'text/plain': 'txt',
	'text/vcard': 'vcf',
	'text/x-vcard': 'vcf',
	'video/mp4': 'mp4',
};

/** The usual file extension of a lower-case media type, `bin` when there is none. */
export function extensionFor(type: string): string {
	return Object.hasOwn(EXTENSIONS, type) ? EXTENSIONS[type]! : 'bin';
}

/**
 * A received part's file name without the directories some programs include (RFC 2183 section 2.3
 * says to ignore them) or control and bidirectional formatting characters; `null` when nothing is
 * left.
 */
export function cleanFileName(name: string | null | undefined): string | null {
	if (!name) return null;
	const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
	const clean = base.replace(CONTROLS, ' ').replace(BIDI, '').replace(/\s+/g, ' ').trim();
	return clean || null;
}

/**
 * `text` as a file name every desktop system accepts: characters Windows or macOS forbid and
 * control characters become spaces, runs of white space one space, leading dots (hidden files) and
 * trailing dots and spaces go, a reserved Windows device name gets a `_`, and the result is cut to
 * `max` characters (never inside a surrogate pair). `fallback` when nothing is left.
 */
export function safeFileName(text: string, fallback: string, max = 76): string {
	const clean = text
		.normalize('NFC')
		.replace(BIDI, '')
		.replace(CONTROLS, ' ')
		.replace(INVALID, ' ')
		.replace(/\s+/g, ' ');
	let name = trimChars(Array.from(trimChars(clean, ' .')).slice(0, max).join(''), ' .');
	if (RESERVED.test(name)) name = `_${name}`;
	return name || fallback;
}

/** The file name a message is exported under: its subject made safe, else `message.eml`. */
export function emlFileName(subject: string): string {
	return `${safeFileName(subject, 'message')}.eml`;
}
