// The URLs of a JMAP session: the session resource for what a person typed (RFC 8620 2.2), and the
// download, upload and event source URL templates (RFC 6570 level 1), resolved and expanded. New
// code.
import { MailTransportError } from '../transport';
import { isSafeUrl } from './redirects';

/**
 * Expands a URI Template of level 1 (RFC 6570), as the session's download, upload and event
 * source URLs are: each `{name}` becomes its percent-encoded value, unknown names nothing.
 */
export function expandTemplate(template: string, values: Readonly<Record<string, string>>): string {
	return template.replace(/\{([^{}]*)\}/g, (_match, name: string) => {
		const value = Object.hasOwn(values, name) ? values[name] : undefined;
		return value === undefined ? '' : encodeURIComponent(value);
	});
}

/** Resolves a (possibly relative) URL template against `base`, keeping its `{variables}` intact. */
export function resolveTemplate(template: string, base: string): string {
	const variables: string[] = [];
	// The URL parser would percent-encode braces in a path; lower-case letters and digits it keeps.
	const masked = template.replace(/\{[^{}]*\}/g, (match) => `jmapvar${variables.push(match) - 1}x`);
	return new URL(masked, base).href.replace(/jmapvar(\d+)x/g, (_match, index: string) => {
		return variables[Number(index)] ?? '';
	});
}

/**
 * The session resource for what a person typed: a session URL as given, or a bare origin
 * (`jmap.example.com`, `https://jmap.example.com/`) with `/.well-known/jmap` (RFC 8620 2.2).
 */
export function sessionResourceUrl(input: string): string {
	const trimmed = input.trim();
	let url: URL;
	try {
		url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
	} catch {
		throw new MailTransportError('invalid', 'The JMAP server address is not a valid URL.');
	}
	if (url.username || url.password)
		throw new MailTransportError(
			'invalid',
			'Pass credentials as auth, never in the server address.',
		);
	if (!isSafeUrl(url.href))
		throw new MailTransportError(
			'invalid',
			'The JMAP server must use https (http only on localhost).',
		);
	if (url.pathname === '/' && !url.search) url.pathname = '/.well-known/jmap';
	return url.href;
}
