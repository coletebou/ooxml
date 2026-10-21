import { utf8 } from './binary';
import { decodeQuotedPrintable, encodeQuotedPrintable } from './quoted-printable';

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const latin = (bytes: Uint8Array): string => String.fromCharCode(...bytes);

describe('decodeQuotedPrintable', () => {
	it('decodes escapes in upper or lower case', () => {
		expect(text(decodeQuotedPrintable('caf=C3=A9 caf=c3=a9'))).toBe('café café');
	});

	it('removes soft line breaks: CRLF, bare LF, with white space after the =, or at the end', () => {
		expect(text(decodeQuotedPrintable('soft=\r\nbreak'))).toBe('softbreak');
		expect(text(decodeQuotedPrintable('soft=\nbreak'))).toBe('softbreak');
		expect(text(decodeQuotedPrintable('soft= \t\r\nbreak'))).toBe('softbreak');
		expect(text(decodeQuotedPrintable('ends with ='))).toBe('ends with ');
		expect(text(decodeQuotedPrintable('ends with =  '))).toBe('ends with ');
	});

	it('keeps hard line breaks and drops white space a transport added at a line end', () => {
		expect(text(decodeQuotedPrintable('one  \r\ntwo\t\nthree'))).toBe('one\r\ntwo\nthree');
		expect(text(decodeQuotedPrintable('kept=20\r\ntab=09\r\n'))).toBe('kept \r\ntab\t\r\n');
		expect(text(decodeQuotedPrintable('inner  spaces stay =\r\n'))).toBe('inner  spaces stay ');
	});

	it('keeps an = that starts no valid escape as written', () => {
		expect(latin(decodeQuotedPrintable('a=ZZb =4 =\tx 1+1=2'))).toBe('a=ZZb =4 =\tx 1+1=2');
	});

	it('passes 8-bit bytes through and accepts bytes as input', () => {
		const decoded = decodeQuotedPrintable(Uint8Array.of(0x41, 0xe9, 0x3d, 0x34, 0x31));
		expect(Array.from(decoded)).toEqual([0x41, 0xe9, 0x41]);
	});

	it('reads _ as a space in header mode only (RFC 2047 Q)', () => {
		expect(text(decodeQuotedPrintable('a_b=5F', { header: true }))).toBe('a b_');
		expect(text(decodeQuotedPrintable('a_b'))).toBe('a_b');
	});
});

describe('encodeQuotedPrintable', () => {
	const encode = (value: string): string => encodeQuotedPrintable(utf8(value));

	it('escapes =, control and 8-bit bytes, and keeps CRLF as hard line breaks', () => {
		expect(encode('a=b\r\ncafé\u0001')).toBe('a=3Db\r\ncaf=C3=A9=01');
	});

	it('escapes white space at the end of a line or of the text, and a lone CR or LF', () => {
		expect(encode('end \r\nlast\t')).toBe('end=20\r\nlast=09');
		expect(encode('a\nb\rc')).toBe('a=0Ab=0Dc');
		expect(encode('mid space')).toBe('mid space');
	});

	it('keeps every line within 76 characters with soft breaks between whole escapes', () => {
		const value = `${'x'.repeat(70)}éééé${'y'.repeat(200)}\r\n${'z '.repeat(60)}`;
		const encoded = encode(value);
		for (const line of encoded.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76);
		expect(encoded).toContain('=\r\n');
		expect(text(decodeQuotedPrintable(encoded))).toBe(value);
	});

	it('round-trips every byte value', () => {
		const all = Uint8Array.from({ length: 256 }, (_, index) => index);
		expect(decodeQuotedPrintable(encodeQuotedPrintable(all))).toEqual(all);
	});
});
