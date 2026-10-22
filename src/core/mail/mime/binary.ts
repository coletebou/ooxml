// Byte helpers of the MIME codec: binary strings (one character per byte, the form transfer
// encodings are read in), UTF-8, and copies that stay plain `Uint8Array`s. New code.

export const CR = 13;
export const LF = 10;

const encoder = new TextEncoder();
const CHUNK = 8192;

/** The UTF-8 bytes of `text`. */
export const utf8 = (text: string): Uint8Array => encoder.encode(text);

/** `bytes` as a binary string: one character, U+0000 to U+00FF, per byte. */
export function toBinary(bytes: Uint8Array): string {
	let out = '';
	for (let i = 0; i < bytes.length; i += CHUNK)
		out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	return out;
}

/**
 * The bytes of a binary string. A character above U+00FF, which no transfer encoding contains, is
 * written as UTF-8, so text that was decoded too early still reads sensibly.
 */
export function fromBinary(text: string): Uint8Array {
	if (!/[^\u0000-\u00ff]/.test(text)) {
		const out = new Uint8Array(text.length);
		for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
		return out;
	}
	const out: number[] = [];
	for (const char of text) {
		const code = char.codePointAt(0)!;
		if (code <= 0xff) out.push(code);
		else out.push(...utf8(char));
	}
	return Uint8Array.from(out);
}

/** True when every byte is 7-bit. */
export function isAscii(bytes: Uint8Array): boolean {
	for (const byte of bytes) if (byte > 0x7f) return false;
	return true;
}

/** The chunks one after another, in a new array. */
export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
	let length = 0;
	for (const chunk of chunks) length += chunk.length;
	const out = new Uint8Array(length);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}
	return out;
}

/** A plain `Uint8Array` over the same memory, so a Node `Buffer` input never leaks into results. */
export function plainBytes(bytes: Uint8Array): Uint8Array {
	return bytes.constructor === Uint8Array
		? bytes
		: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
