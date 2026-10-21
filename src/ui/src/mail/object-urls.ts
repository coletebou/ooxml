// The object URLs the mail app makes for message parts and files. A `blob:` URL belongs to the
// app's own origin, so a page a browser opens from one (a picture opened in a tab of its own, say)
// runs as the app. A part a browser could open as a page that runs script (HTML, SVG, any XML, or
// bytes it would have to guess the type of) therefore never gets one as its own type: such a
// picture gets a `data:` URL instead (an opaque origin, which a page cannot open in a tab of its
// own either), and such a download goes as plain bytes, which a browser saves rather than shows.
// New code.
import { encodeBase64 } from 'ooxml-core/digest';

/** A type and subtype, each an HTTP token (RFC 9110), without parameters. */
const ESSENCE = /^[\w!#$%&'*+.^`|~-]+\/[\w!#$%&'*+.^`|~-]+$/;
/** Types a browser shows as a page that can run script: HTML, SVG and every XML type. */
const SCRIPTED =
	/^(?:text\/html|text\/xml|application\/xml|text\/xsl|multipart\/x-mixed-replace)$|\+xml$/;
/**
 * Placeholders a browser reads as "no type", guessing the type from the bytes: those of the MIME
 * Sniffing standard, and the name one browser gives an unknown type of its own.
 */
const GUESSED = new Set([
	'unknown/unknown',
	'application/unknown',
	'*/*',
	'application/x-unknown-content-type',
]);
const BYTES = 'application/octet-stream';

/** The type and subtype of a MIME type in lower case, or '' when it is not a valid one. */
function essenceOf(type: string): string {
	const essence = type.split(';')[0]!.trim().toLowerCase();
	return ESSENCE.test(essence) ? essence : '';
}

/** Whether a type (its essence, '' when invalid) is one a browser could run script in. */
const scripted = (essence: string): boolean =>
	!essence || GUESSED.has(essence) || SCRIPTED.test(essence);

/**
 * Whether a browser opening bytes of `type` as a page could run script in them: HTML, SVG, XML,
 * and a missing, invalid or placeholder type, for which it guesses the type from the bytes.
 */
export function activeType(type: string): boolean {
	return scripted(essenceOf(type));
}

/**
 * A URL to show a picture from: `blob:` for a type that cannot run script, else `data:`. A blob
 * gets the type as checked here, so a browser can read no other type from it.
 */
export function imageUrl(bytes: Uint8Array, type: string): string {
	const essence = essenceOf(type);
	if (!scripted(essence))
		return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: essence }));
	return `data:${essence || BYTES};base64,${encodeBase64(bytes)}`;
}

/** Save bytes as a download in the browser (as plain bytes when their type could run script). */
export function downloadBytes(doc: Document, bytes: Uint8Array, name: string, type: string): void {
	const essence = essenceOf(type);
	const blob = new Blob([new Uint8Array(bytes)], { type: scripted(essence) ? BYTES : essence });
	const url = URL.createObjectURL(blob);
	const link = doc.createElement('a');
	link.href = url;
	link.download = name;
	link.rel = 'noopener';
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
