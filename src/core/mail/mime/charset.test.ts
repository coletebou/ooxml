import { utf8 } from './binary';
import { decodeCharset, decodeUnlabelled, normalizeCharset } from './charset';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
const ascii = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));

describe('normalizeCharset', () => {
	it('maps the aliases mail programs write onto WHATWG labels', () => {
		expect(normalizeCharset('UTF8')).toBe('utf-8');
		expect(normalizeCharset('"utf-8"')).toBe('utf-8');
		expect(normalizeCharset('cp1252')).toBe('windows-1252');
		expect(normalizeCharset('Windows-1250')).toBe('windows-1250');
		expect(normalizeCharset('ms932')).toBe('shift_jis');
		expect(normalizeCharset('cp936')).toBe('gbk');
		expect(normalizeCharset('iso8859_15')).toBe('iso-8859-15');
		expect(normalizeCharset('ISO_8859-1')).toBe('iso-8859-1');
		expect(normalizeCharset('latin-1')).toBe('iso-8859-1');
		expect(normalizeCharset('ANSI_X3.4-1968')).toBe('us-ascii');
		expect(normalizeCharset('unicode-1-1-utf-7')).toBe('utf-7');
	});

	it('drops the RFC 2231 section 5 language suffix', () => {
		expect(normalizeCharset('US-ASCII*EN')).toBe('us-ascii');
		expect(normalizeCharset('utf-8*de-CH')).toBe('utf-8');
	});

	it('reads missing and meaningless labels as no charset', () => {
		for (const label of [undefined, null, '', ' ', 'unknown-8bit', 'x-unknown', 'x-user-defined'])
			expect(normalizeCharset(label)).toBe('');
	});
});

describe('decodeCharset', () => {
	it('decodes the charset it is given', () => {
		expect(decodeCharset(bytes(0x63, 0x61, 0x66, 0xc3, 0xa9), 'utf-8')).toBe('café');
		expect(decodeCharset(bytes(0x63, 0x61, 0x66, 0xe9), 'iso-8859-1')).toBe('café');
		expect(decodeCharset(bytes(0x80, 0x93, 0x94, 0x96), 'windows-1252')).toBe('€“”–');
		expect(decodeCharset(bytes(0xb5), 'iso-8859-2')).toBe('ľ');
		expect(decodeCharset(bytes(0xc1), 'koi8-r')).toBe('а');
		expect(decodeCharset(bytes(0x82, 0xa0), 'cp932')).toBe('あ');
		expect(decodeCharset(bytes(0xed, 0xe5, 0xec, 0xf9), 'iso-8859-8')).toBe('םולש');
	});

	it('reads us-ascii text with 8-bit bytes as UTF-8 when valid, else windows-1252', () => {
		expect(decodeCharset(utf8('naïve'), 'us-ascii')).toBe('naïve');
		expect(decodeCharset(bytes(0x6e, 0x61, 0xef, 0x76, 0x65), 'us-ascii')).toBe('naïve');
		expect(decodeCharset(ascii('plain'), 'us-ascii')).toBe('plain');
	});

	it('falls back the same way for unknown, unsupported or missing charsets', () => {
		expect(decodeCharset(utf8('déjà vu'), 'x-bogus')).toBe('déjà vu');
		expect(decodeCharset(bytes(0xe9, 0x74, 0xe9), 'cp850')).toBe('été');
		expect(decodeCharset(bytes(0xe9), undefined)).toBe('é');
		// A WHATWG "replacement" encoding, which TextDecoder refuses.
		expect(decodeCharset(bytes(0xe9), 'iso-2022-kr')).toBe('é');
		expect(decodeUnlabelled(bytes(0xe2, 0x82, 0xac))).toBe('€');
	});

	it('marks invalid sequences in declared UTF-8 instead of guessing', () => {
		expect(decodeCharset(bytes(0x61, 0xff, 0x62), 'utf-8')).toBe('a�b');
	});

	it('decodes UTF-7 with the examples of RFC 2152', () => {
		expect(decodeCharset(ascii('A+ImIDkQ.'), 'utf-7')).toBe('A≢Α.');
		expect(decodeCharset(ascii('Hi Mom -+Jjo--!'), 'utf-7')).toBe('Hi Mom -☺-!');
		expect(decodeCharset(ascii('+ZeVnLIqe-'), 'utf-7')).toBe('日本語');
		expect(decodeCharset(ascii('1 +- 1 = 2'), 'UTF-7')).toBe('1 + 1 = 2');
	});
});
