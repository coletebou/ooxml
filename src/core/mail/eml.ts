// `.eml` files: a single RFC 5322 message saved as it travels. Import reads one with the MIME
// codec, export writes one, and the helpers here recognise such files and name them. New code.
export { emlFileName } from './mime/file-names';
export { readEmail as importEml, writeEmail as exportEml } from './mime';

/** True for a file that holds one message: an `.eml` name, or a `message/rfc822` type. */
export function isEmlFile(name: string, type?: string): boolean {
	const media = type?.split(';')[0]?.trim().toLowerCase();
	return media === 'message/rfc822' || media === 'message/global' || /\.eml$/i.test(name.trim());
}
