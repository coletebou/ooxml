import { foldHeader } from './headers';
import { formatParameters, parseContentDisposition, parseContentType } from './parameters';

describe('parseContentType', () => {
	it('reads type, subtype and parameter names in lower case, values as written', () => {
		expect(parseContentType('Text/HTML; Charset="UTF-8"; Format=Flowed')).toEqual({
			type: 'text',
			subtype: 'html',
			params: { charset: 'UTF-8', format: 'Flowed' },
		});
	});

	it('defaults as RFC 2045 section 5.2 says when the field is missing or unreadable', () => {
		const plain = { type: 'text', subtype: 'plain', params: { charset: 'us-ascii' } };
		expect(parseContentType(undefined)).toEqual(plain);
		expect(parseContentType('')).toEqual(plain);
		expect(parseContentType('; charset=utf-8')).toEqual({ ...plain, params: { charset: 'utf-8' } });
		expect(parseContentType(undefined, 'message/rfc822')).toEqual({
			type: 'message',
			subtype: 'rfc822',
			params: {},
		});
	});

	it('skips comments and white space, but not inside quoted strings', () => {
		expect(parseContentType('text/plain; charset=us-ascii (Plain text)')).toEqual({
			type: 'text',
			subtype: 'plain',
			params: { charset: 'us-ascii' },
		});
		expect(parseContentType('text / plain ; charset = "utf-8"').params).toEqual({
			charset: 'utf-8',
		});
		expect(parseContentType('(comment) multipart/mixed; boundary="(not a comment)"')).toEqual({
			type: 'multipart',
			subtype: 'mixed',
			params: { boundary: '(not a comment)' },
		});
	});

	it('joins the continuations of RFC 2231 section 3', () => {
		const value =
			'message/external-body; access-type=URL; URL*0="ftp://"; URL*1="cs.utk.edu/pub/moore/bulk-mailer/bulk-mailer.tar"';
		expect(parseContentType(value).params).toEqual({
			'access-type': 'URL',
			url: 'ftp://cs.utk.edu/pub/moore/bulk-mailer/bulk-mailer.tar',
		});
	});

	it('decodes the charsets and languages of RFC 2231 section 4', () => {
		const value = "application/x-stuff; title*=us-ascii'en-us'This%20is%20%2A%2A%2Afun%2A%2A%2A";
		expect(parseContentType(value).params).toEqual({ title: 'This is ***fun***' });
	});

	it('combines encoded and plain continuations (RFC 2231 section 4.1, printed without semicolons)', () => {
		const value = `application/x-stuff title*0*=us-ascii'en'This%20is%20even%20more%20 title*1*=%2A%2A%2Afun%2A%2A%2A%20 title*2="isn't it!"`;
		expect(parseContentType(value)).toEqual({
			type: 'application',
			subtype: 'x-stuff',
			params: { title: "This is even more ***fun*** isn't it!" },
		});
	});

	it('decodes encoded words in a quoted name, which many programs write, and nowhere else', () => {
		expect(
			parseContentType('application/pdf; name="=?UTF-8?B?UsOpc3Vtw6kucGRm?="').params.name,
		).toBe('Résumé.pdf');
		expect(parseContentType('multipart/mixed; boundary="=?utf-8?q?x?="').params.boundary).toBe(
			'=?utf-8?q?x?=',
		);
	});

	it('reads what mail programs get wrong', () => {
		expect(parseContentType('text/plain charset=utf-8').params).toEqual({ charset: 'utf-8' });
		expect(parseContentType('text; charset=utf-8')).toEqual({
			type: 'text',
			subtype: 'plain',
			params: { charset: 'utf-8' },
		});
		expect(parseContentType('multipart; boundary=x')).toMatchObject({
			type: 'multipart',
			subtype: 'mixed',
		});
		expect(parseContentType('image')).toEqual({
			type: 'application',
			subtype: 'octet-stream',
			params: {},
		});
		expect(parseContentType('text/plain; charset=utf-8; charset=latin1').params.charset).toBe(
			'utf-8',
		);
		expect(parseContentType('text/plain; __proto__=x; constructor=y').params).toEqual({
			constructor: 'y',
		});
	});
});

describe('parseContentDisposition', () => {
	it('reads the type in lower case, empty when the field is missing', () => {
		expect(parseContentDisposition('INLINE')).toEqual({ type: 'inline', params: {} });
		expect(parseContentDisposition(undefined)).toEqual({ type: '', params: {} });
	});

	it('reads RFC 2231 file names in any charset, in any order, over a plain one', () => {
		expect(parseContentDisposition("attachment; filename*=utf-8'en'%E2%82%AC%20rates.pdf")).toEqual(
			{
				type: 'attachment',
				params: { filename: '€ rates.pdf' },
			},
		);
		const split = "attachment; filename*0*=utf-8''R%C3%A9sum%C3%A9%20; filename*1*=final.pdf";
		expect(parseContentDisposition(split).params.filename).toBe('Résumé final.pdf');
		expect(
			parseContentDisposition('attachment; filename*1=b.txt; filename*0=a').params.filename,
		).toBe('ab.txt');
		expect(
			parseContentDisposition("attachment; filename*=iso-8859-1''caf%E9.txt").params.filename,
		).toBe('café.txt');
		const both = "attachment; filename=plain.txt; filename*=utf-8''fancy%E2%9C%93.txt";
		expect(parseContentDisposition(both).params.filename).toBe('fancy✓.txt');
	});

	it('keeps unquoted names with spaces and parentheses, and bare backslashes', () => {
		expect(parseContentDisposition('attachment; filename=report (1).pdf').params.filename).toBe(
			'report (1).pdf',
		);
		expect(
			parseContentDisposition('attachment; filename="C:\\Users\\ada\\notes.txt"').params.filename,
		).toBe('C:\\Users\\ada\\notes.txt');
		expect(parseContentDisposition('attachment; filename="say \\"hi\\".txt"').params.filename).toBe(
			'say "hi".txt',
		);
		expect(parseContentDisposition('attachment; filename="unterminated.txt').params.filename).toBe(
			'unterminated.txt',
		);
		expect(parseContentDisposition('attachment;; ;filename=a.txt;').params).toEqual({
			filename: 'a.txt',
		});
		expect(parseContentDisposition('attachment; size; filename=a.txt').params).toEqual({
			filename: 'a.txt',
		});
	});
});

describe('formatParameters', () => {
	it('writes tokens bare and other ASCII quoted', () => {
		expect(formatParameters({ charset: 'utf-8', boundary: '=_0_abc', name: 'my "file".txt' })).toBe(
			'; charset=utf-8; boundary="=_0_abc"; name="my \\"file\\".txt"',
		);
		expect(formatParameters({})).toBe('');
	});

	it('writes non-ASCII values, and names that look like encoded words, in RFC 2231 form', () => {
		expect(formatParameters({ filename: 'café.pdf' })).toBe("; filename*=utf-8''caf%C3%A9.pdf");
		const tricky = '=?utf-8?q?x?=.txt';
		const written = formatParameters({ filename: tricky });
		expect(written).toContain("filename*=utf-8''");
		expect(parseContentDisposition(`attachment${written}`).params.filename).toBe(tricky);
	});

	it('splits long values into continuations that fold within 78 characters and read back whole', () => {
		for (const value of [
			`${'Résumé '.repeat(20)}.pdf`,
			`${'a'.repeat(150)}.txt`,
			`${'😀'.repeat(30)}.png`,
		]) {
			const written = formatParameters({ filename: value });
			expect(written).toMatch(/filename\*0\*?=/);
			const field = foldHeader('Content-Disposition', `attachment${written}`);
			for (const line of field.split('\r\n')) expect(line.length).toBeLessThanOrEqual(78);
			expect(parseContentDisposition(`attachment${written}`).params.filename).toBe(value);
		}
	});
});
