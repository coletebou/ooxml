import { utf8 } from './binary';
import { splitMultipart } from './multipart';
import { decodeBase64Body, decodeTransfer, encodeBase64Lines, transferEncoding } from './transfer';

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe('transferEncoding', () => {
	it('reads the encodings, 7bit when missing, null when unknown', () => {
		expect(transferEncoding(undefined)).toBe('7bit');
		expect(transferEncoding(' Quoted-Printable ')).toBe('quoted-printable');
		expect(transferEncoding('BASE64 (comment)')).toBe('base64');
		expect(transferEncoding('8-bit')).toBe('8bit');
		expect(transferEncoding('binary')).toBe('binary');
		expect(transferEncoding('x-uuencode')).toBeNull();
	});
});

describe('decodeBase64Body', () => {
	it('decodes base64 in lines', () => {
		expect(text(decodeBase64Body(ascii('SGVsbG8s\r\nIHdvcmxk\r\nIQ==\r\n')))).toBe('Hello, world!');
	});

	it('decodes truncated base64, stray characters and padding in the middle as far as they go', () => {
		expect(text(decodeBase64Body(ascii('SGVsbG8sIHdvcmxkIQ==SGVs\nbG8gYWdh\naW4')))).toBe(
			'Hello, world!Hello again',
		);
		expect(text(decodeBase64Body(ascii('SGVsbG8gV')))).toBe('Hello ');
		expect(text(decodeBase64Body(ascii('SGVs*bG8')))).toBe('Hello');
		expect(decodeBase64Body(ascii('!!!'))).toEqual(new Uint8Array(0));
	});

	it('decodes what it writes, padded or not, whatever the length', () => {
		for (let length = 0; length < 64; length++) {
			const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + length * 11) & 0xff);
			const lines = encodeBase64Lines(bytes);
			expect(decodeBase64Body(ascii(lines)), `${length}`).toEqual(bytes);
			expect(decodeBase64Body(ascii(lines.replace(/=+$/, ''))), `${length}`).toEqual(bytes);
		}
	});
});

describe('decodeTransfer', () => {
	it('decodes base64 and quoted-printable, and passes the identity encodings through uncopied', () => {
		const body = ascii('abc');
		for (const encoding of ['7bit', '8bit', 'binary', null] as const)
			expect(decodeTransfer(body, encoding)).toBe(body);
		expect(text(decodeTransfer(ascii('caf=C3=A9'), 'quoted-printable'))).toBe('café');
		expect(text(decodeTransfer(ascii('Y2Fmw6k='), 'base64'))).toBe('café');
	});
});

describe('encodeBase64Lines', () => {
	it('writes lines of 76 characters joined by CRLF', () => {
		const lines = encodeBase64Lines(new Uint8Array(200)).split('\r\n');
		expect(lines.map((line) => line.length)).toEqual([76, 76, 76, 40]);
		expect(encodeBase64Lines(new Uint8Array(0))).toBe('');
	});
});

describe('splitMultipart', () => {
	const parts = (body: string, boundary: string): string[] => {
		const bytes = utf8(body);
		return splitMultipart(bytes, boundary).parts.map(([start, end]) =>
			text(bytes.subarray(start, end)),
		);
	};

	it('finds the parts between delimiters, dropping the preamble and epilogue', () => {
		const body = 'preamble\r\n--b\r\nA: 1\r\n\r\none\r\n--b \t\r\n\r\ntwo\r\n--b--\r\nepilogue';
		expect(parts(body, 'b')).toEqual(['A: 1\r\n\r\none', '\r\ntwo']);
		expect(splitMultipart(utf8(body), 'b').closed).toBe(true);
	});

	it('reads delimiters at the very start and with bare LF line breaks', () => {
		expect(parts('--b\none\n--b\ntwo\n--b--', 'b')).toEqual(['one', 'two']);
	});

	it('tells at most `limit` parts apart and keeps the rest as one range', () => {
		const body = '--b\r\none\r\n--b\r\ntwo\r\n--b\r\nthree\r\n--b\r\nfour\r\n--b--\r\nepilogue';
		const bytes = utf8(body);
		const split = splitMultipart(bytes, 'b', 2);
		expect(split.closed).toBe(true);
		expect(split.parts.map(([start, end]) => text(bytes.subarray(start, end)))).toEqual([
			'one',
			'two',
			'three\r\n--b\r\nfour',
		]);
		// Millions of empty parts cost one range past the limit, not one each.
		expect(splitMultipart(utf8(`${'--b\r\n'.repeat(100_000)}--b--`), 'b', 3).parts).toHaveLength(4);
		expect(splitMultipart(bytes, 'b', 0).parts.map(([s, e]) => text(bytes.subarray(s, e)))).toEqual(
			['one\r\n--b\r\ntwo\r\n--b\r\nthree\r\n--b\r\nfour'],
		);
		expect(splitMultipart(utf8('--b\r\none\r\n--b\r\ntwo'), 'b', 1).parts).toHaveLength(2);
	});

	it('ends the last part at the end of the body when the close delimiter is missing', () => {
		const split = splitMultipart(utf8('--b\r\none\r\n--b\r\ntwo\r\n'), 'b');
		expect(split.closed).toBe(false);
		expect(parts('--b\r\none\r\n--b\r\ntwo\r\n', 'b')).toEqual(['one', 'two\r\n']);
	});

	it('takes neither a longer boundary nor one followed by other text for a delimiter', () => {
		expect(parts('--b\r\none\r\n--bb\r\n--b-x\r\n --b\r\n--b--', 'b')).toEqual([
			'one\r\n--bb\r\n--b-x\r\n --b',
		]);
	});

	it('finds no parts without a delimiter', () => {
		expect(parts('no delimiters here', 'b')).toEqual([]);
	});
});
