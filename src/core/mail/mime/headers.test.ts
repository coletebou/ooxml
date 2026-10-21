import { concatBytes, utf8 } from './binary';
import { foldHeader, getHeader, getHeaders, parseHeaders, splitMessage } from './headers';

const rest = (bytes: Uint8Array, offset: number): string =>
	new TextDecoder().decode(bytes.subarray(offset));

describe('splitMessage', () => {
	it('splits at the first empty line, CRLF or a bare LF', () => {
		const crlf = utf8('Subject: a\r\nTo: b\r\n\r\nbody\r\n\r\nmore');
		const split = splitMessage(crlf);
		expect(split.header).toBe('Subject: a\r\nTo: b\r\n');
		expect(rest(crlf, split.bodyOffset)).toBe('body\r\n\r\nmore');
		const lf = utf8('Subject: a\n\nbody');
		expect(rest(lf, splitMessage(lf).bodyOffset)).toBe('body');
	});

	it('reads a header block without a body, and a body without a header block', () => {
		expect(splitMessage(utf8('Subject: only'))).toEqual({
			header: 'Subject: only',
			bodyOffset: 13,
		});
		expect(splitMessage(utf8('\r\nbody'))).toEqual({ header: '', bodyOffset: 2 });
		expect(splitMessage(new Uint8Array(0))).toEqual({ header: '', bodyOffset: 0 });
	});

	it('starts the body at a line that is neither a field nor a fold', () => {
		const bytes = utf8('Subject: x\nThis line starts the body\n');
		const split = splitMessage(bytes);
		expect(split.header).toBe('Subject: x\n');
		expect(rest(bytes, split.bodyOffset)).toBe('This line starts the body\n');
	});

	it('keeps the obsolete fold made of a white-space-only line (RFC 5322 A.6.3)', () => {
		const bytes = utf8('To    : Mary Smith\r\n  \r\n          <mary@example.net>\r\n\r\nx');
		expect(parseHeaders(splitMessage(bytes).header)).toEqual([
			{ name: 'To', value: 'Mary Smith            <mary@example.net>' },
		]);
	});

	it('takes a white-space-only first line for the blank line', () => {
		const bytes = utf8(' \r\nbody');
		expect(splitMessage(bytes)).toEqual({ header: '', bodyOffset: 3 });
	});

	it('skips the mbox From line an .eml saved from mbox starts with', () => {
		const bytes = utf8('From ada@example.com Mon Jan  5 09:00:00 2026\nSubject: hi\n\nbody');
		const split = splitMessage(bytes);
		expect(parseHeaders(split.header)).toEqual([{ name: 'Subject', value: 'hi' }]);
		expect(rest(bytes, split.bodyOffset)).toBe('body');
	});

	it('keeps a first field written `From  :`, which only looks like an mbox line', () => {
		const bytes = utf8('From  : John Doe <jdoe@example.com>\nSubject: hi\n\nbody');
		expect(parseHeaders(splitMessage(bytes).header)).toEqual([
			{ name: 'From', value: 'John Doe <jdoe@example.com>' },
			{ name: 'Subject', value: 'hi' },
		]);
	});

	it('reads UTF-8 fields (RFC 6532), and lines that are not UTF-8 as windows-1252', () => {
		const bytes = concatBytes([
			utf8('Subject: café\r\nX-Old: caf'),
			Uint8Array.of(0xe9, 0x0d, 0x0a, 0x0d, 0x0a),
		]);
		expect(parseHeaders(splitMessage(bytes).header)).toEqual([
			{ name: 'Subject', value: 'café' },
			{ name: 'X-Old', value: 'café' },
		]);
	});
});

describe('parseHeaders', () => {
	it('unfolds by removing the line breaks only, keeping order and duplicates', () => {
		const text =
			'Received: from x\r\n\tby y; Fri, 21 Nov 1997 09:55:06 -0600\r\nReceived: from z\r\nSubject: This\r\n is a test\r\n';
		expect(parseHeaders(text)).toEqual([
			{ name: 'Received', value: 'from x\tby y; Fri, 21 Nov 1997 09:55:06 -0600' },
			{ name: 'Received', value: 'from z' },
			{ name: 'Subject', value: 'This is a test' },
		]);
	});

	it('accepts white space before the colon (RFC 5322 A.6.3) and empty values', () => {
		expect(parseHeaders('Subject     : Saying Hello\nX-Empty:\nFrom  : John\n')).toEqual([
			{ name: 'Subject', value: 'Saying Hello' },
			{ name: 'X-Empty', value: '' },
			{ name: 'From', value: 'John' },
		]);
	});

	it('skips lines that are not fields and stops at an empty line', () => {
		expect(parseHeaders(' orphan fold\nA: 1\nnot a field\nB: 2\n\nC: 3')).toEqual([
			{ name: 'A', value: '1' },
			{ name: 'B', value: '2' },
		]);
	});
});

describe('getHeader and getHeaders', () => {
	it('match names case-insensitively; getHeader reads the last, as RFC 8621 does', () => {
		const fields = parseHeaders('subject: one\nSUBJECT: two\nTo: a\n');
		expect(getHeader(fields, 'Subject')).toBe('two');
		expect(getHeaders(fields, 'subject')).toEqual(['one', 'two']);
		expect(getHeader(fields, 'From')).toBeUndefined();
		expect(getHeaders(fields, 'From')).toEqual([]);
	});
});

describe('foldHeader', () => {
	it('keeps a short field on one line and an empty one without trailing space', () => {
		expect(foldHeader('Subject', 'Hello')).toBe('Subject: Hello');
		expect(foldHeader('Subject', '')).toBe('Subject:');
	});

	it('folds before white space within 78 characters, and unfolding gives the value back', () => {
		const value = Array.from({ length: 40 }, (_, index) => `word${index}`).join(' ');
		const folded = foldHeader('Subject', value);
		const lines = folded.split('\r\n');
		expect(lines.length).toBeGreaterThan(1);
		for (const line of lines) expect(line.length).toBeLessThanOrEqual(78);
		for (const line of lines.slice(1)) expect(line).toMatch(/^[ \t]\S/);
		expect(parseHeaders(folded)).toEqual([{ name: 'Subject', value }]);
	});

	it('keeps runs of white space when it folds there', () => {
		const value = `${'a'.repeat(60)}   ${'b'.repeat(30)}\t${'c'.repeat(30)}`;
		expect(parseHeaders(foldHeader('X-Test', value))).toEqual([{ name: 'X-Test', value }]);
	});

	it('never folds inside a word, so never inside an encoded word', () => {
		const word = `=?UTF-8?B?${'QUJD'.repeat(14)}?=`;
		const folded = foldHeader('Subject', `${word} ${word} ${word}`);
		expect(folded.split('\r\n').map((line) => line.trim())).toEqual([
			`Subject: ${word}`,
			word,
			word,
		]);
	});

	it('turns line breaks in a value into spaces, so a value cannot add a field', () => {
		const folded = foldHeader('Subject', 'hi\r\nBcc: someone@example.com\nX: y');
		expect(parseHeaders(folded)).toEqual([
			{ name: 'Subject', value: 'hi Bcc: someone@example.com X: y' },
		]);
	});

	it('cuts a word longer than the hard limit of 998 characters', () => {
		const folded = foldHeader('X-Long', 'a'.repeat(2500));
		const lines = folded.split('\r\n');
		expect(lines.length).toBe(3);
		for (const line of lines) expect(line.length).toBeLessThanOrEqual(998);
	});
});
