// Dates, sizes and names as the mail views show them, through `Intl` in the display locale (the
// browser's own conventions while no locale is set). New code.
import { displayName, type MailAddress } from 'ooxml-core/mail';
import type { MailI18n } from './i18n/translator';

const DAY_MS = 86_400_000;
const startOfDay = (ms: number): number => new Date(ms).setHours(0, 0, 0, 0);

/** A list date: the time today, the weekday this week, the date this year, else the full date. */
export function listDate(ms: number, i18n: MailI18n, now = Date.now()): string {
	const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS);
	const date = new Date(ms);
	if (days === 0) return date.toLocaleTimeString(i18n.intl, { hour: 'numeric', minute: '2-digit' });
	if (days > 0 && days < 7) return date.toLocaleDateString(i18n.intl, { weekday: 'short' });
	if (date.getFullYear() === new Date(now).getFullYear())
		return date.toLocaleDateString(i18n.intl, { month: 'short', day: 'numeric' });
	return date.toLocaleDateString(i18n.intl, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** The full date and time of a message header. */
export function fullDate(ms: number, i18n: MailI18n): string {
	return new Date(ms).toLocaleString(i18n.intl, {
		weekday: 'short',
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	});
}

/** `1.2 MB`, `340 KB`, `12 bytes`, with the locale's digits. */
export function fileSize(bytes: number, i18n: MailI18n): string {
	const number = (n: number, digits = 0): string =>
		new Intl.NumberFormat(i18n.intl, { maximumFractionDigits: digits }).format(n);
	if (bytes < 1024) return i18n.t('size.bytes', { size: number(bytes) });
	if (bytes < 1_048_576) return i18n.t('size.kb', { size: number(Math.round(bytes / 1024)) });
	return i18n.t('size.mb', { size: number(bytes / 1_048_576, 1) });
}

/** Names of a list of people, joined the way the locale joins lists. */
export function names(addresses: readonly MailAddress[], i18n: MailI18n): string {
	const list = addresses.map(displayName);
	try {
		return new Intl.ListFormat(i18n.intl, { style: 'short', type: 'conjunction' }).format(list);
	} catch {
		return list.join(', ');
	}
}

/** One or two initials for an avatar. */
export function initials(address: MailAddress | undefined): string {
	const name = address ? displayName(address) : '?';
	const parts = name.split(/[\s._-]+/).filter(Boolean);
	const letters = parts.length > 1 ? [parts[0]![0], parts.at(-1)![0]] : [name[0]];
	return letters.join('').toUpperCase();
}

/** A stable hue per address, so one person looks the same everywhere. */
export function hueOf(email: string): number {
	let hue = 0;
	for (const char of email.toLowerCase()) hue = (hue * 31 + char.charCodeAt(0)) % 360;
	return hue;
}
