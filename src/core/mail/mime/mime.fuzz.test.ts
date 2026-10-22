import { readFileSync } from 'node:fs';
import * as fc from 'fast-check';
import { formatAddressList, parseAddressList, parseMessageIds } from './addresses';
import { writeEmail } from './build';
import { normalizeCharset } from './charset';
import { parseDate } from './dates';
import { decodeEncodedWords, encodeHeaderText } from './encoded-words';
import { cleanFileName, emlFileName } from './file-names';
import { foldHeader, parseHeaders } from './headers';
import { formatParameters, parseContentDisposition, parseContentType } from './parameters';
import { parseEmail } from './parse';
import { decodeQuotedPrintable, encodeQuotedPrintable } from './quoted-printable';

/** Drops lone surrogates, which UTF-8 cannot carry, so a string survives encoding as it is. */
function wellFormed(text: string): string {
	return Array.from(text)
		.filter(
			(char) => char.length === 2 || char.charCodeAt(0) < 0xd800 || char.charCodeAt(0) > 0xdfff,
		)
		.join('');
}
const unicode = (maxLength: number): fc.Arbitrary<string> =>
	fc.string({ unit: 'binary', maxLength }).map(wellFormed);
const mixed = (maxLength: number): fc.Arbitrary<string> =>
	fc.oneof(unicode(maxLength), fc.string({ maxLength }), fc.stringMatching(/^[ -~\t\r\n]{0,80}$/));
const trimBlanks = (text: string): string => text.replace(/^[ \t]+|[ \t]+$/g, '');

describe('MIME codec properties', () => {
	it('quoted-printable gives back any bytes, in lines of at most 76 characters', () => {
		fc.assert(
			fc.property(fc.uint8Array({ maxLength: 600 }), (bytes) => {
				const encoded = encodeQuotedPrintable(bytes);
				for (const line of encoded.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76);
				expect(decodeQuotedPrintable(encoded)).toEqual(bytes);
			}),
			{ numRuns: 300 },
		);
	});

	it('encoded header text decodes to the same string, in words of at most 66 characters', () => {
		fc.assert(
			fc.property(mixed(150), (text) => {
				const encoded = encodeHeaderText(text);
				for (const [word] of encoded.matchAll(/=\?UTF-8\?[BQ]\?[^?]*\?=/g))
					expect(word.length).toBeLessThanOrEqual(66);
				expect(decodeEncodedWords(encoded)).toBe(text);
			}),
			{ numRuns: 400 },
		);
	});

	it('a folded field unfolds to its value, in lines of at most 78 characters between words', () => {
		fc.assert(
			fc.property(fc.stringMatching(/^[ -~\t]{0,300}$/), (value) => {
				const folded = foldHeader('X-Test', value);
				const words = value.split(/[ \t]+/);
				if (words.every((word) => word.length < 60))
					for (const line of folded.split('\r\n')) expect(line.length).toBeLessThanOrEqual(78);
				expect(parseHeaders(folded)).toEqual([{ name: 'X-Test', value: trimBlanks(value) }]);
			}),
			{ numRuns: 300 },
		);
	});

	it('an address list reads back with the same display names and addresses', () => {
		fc.assert(
			fc.property(fc.array(fc.tuple(mixed(40), fc.emailAddress()), { maxLength: 4 }), (pairs) => {
				const list = pairs.map(([name, email]) => ({ name, email }));
				const expected = list.map(({ name, email }) => ({ name: name.trim(), email }));
				expect(parseAddressList(formatAddressList(list))).toEqual(expected);
			}),
			{ numRuns: 300 },
		);
	});

	it('a file name parameter reads back exactly, whatever its characters or length', () => {
		fc.assert(
			fc.property(mixed(160), (filename) => {
				const written = formatParameters({ filename });
				expect(parseContentDisposition(`attachment${written}`).params.filename).toBe(filename);
			}),
			{ numRuns: 300 },
		);
	});

	it('a written message reads back with the same subject, names, bodies and files', () => {
		const message = fc.record({
			subject: mixed(80),
			name: mixed(30),
			text: mixed(300),
			html: mixed(200),
			files: fc.array(fc.record({ name: mixed(40), bytes: fc.uint8Array({ maxLength: 300 }) }), {
				maxLength: 3,
			}),
		});
		fc.assert(
			fc.property(message, ({ subject, name, text, html, files }) => {
				const raw = writeEmail({
					from: { name, email: 'ada@example.com' },
					to: [{ name: 'Grace', email: 'grace@example.org' }],
					subject,
					text,
					html,
					attachments: files.map((file) => ({ ...file, type: 'application/octet-stream' })),
				});
				const email = parseEmail(raw);
				expect(email.subject).toBe(trimBlanks(subject));
				expect(email.from).toEqual([{ name: name.trim(), email: 'ada@example.com' }]);
				expect(email.text).toBe(text.replace(/\r\n|\r/g, '\n'));
				expect(email.html).toBe(html ? html.replace(/\r\n|\r/g, '\n') : null);
				expect(email.attachments.map((file) => [file.name, file.bytes])).toEqual(
					files.map((file, index) => [
						cleanFileName(file.name) ?? `attachment-${index + 1}.bin`,
						file.bytes,
					]),
				);
				const lines = new TextDecoder().decode(raw).split('\r\n');
				for (const line of lines) expect(line.length).toBeLessThanOrEqual(998);
			}),
			{ numRuns: 200 },
		);
	});
});

const PIECES = [
	'--b',
	'--b--',
	'--c',
	'--c--',
	'',
	'Content-Type: multipart/mixed; boundary=b',
	'Content-Type: multipart/alternative; boundary="c"',
	'Content-Type: multipart/digest; boundary=b',
	'Content-Type: message/rfc822',
	'Content-Type: text/html; charset=utf-7',
	'Content-Transfer-Encoding: base64',
	'Content-Transfer-Encoding: quoted-printable',
	"Content-Disposition: attachment; filename*0*=utf-8''%FF%; filename*1=\"x",
	'Content-ID: <a@b>',
	'From: (x <y@z>, "q',
	'Subject: =?x?q?=FF?= =?utf-8?b?w6k=?=',
	'Date: 99 Foo 3000 25:61',
	' folded continuation',
	'SGVsbG8=SGk',
	'=',
	'=\r',
	'caf=E9 =ZZ',
	'random text',
];

describe('readEmail on hostile input', () => {
	it('stays linear on the long runs that make naive patterns backtrack', () => {
		const n = 200_000;
		const spaces = ' '.repeat(n);
		const cases: Array<[string, () => unknown]> = [
			['a header value', () => parseHeaders(`X: a${spaces}b\n`)],
			['a folded value', () => foldHeader('X', `a${spaces}b`)],
			['a field name without a colon', () => parseHeaders(`${'a'.repeat(n)}\n`)],
			['a charset label', () => normalizeCharset(`a${'"'.repeat(n)}b`)],
			['a message id', () => parseMessageIds(`a${'>'.repeat(n)}b@c`)],
			['a subject as a file name', () => emlFileName(`a${'.'.repeat(n)}b`)],
			['a media type', () => parseContentType(`text${spaces}plain`)],
			['a parameter value', () => parseContentType(`text/plain; name=a${spaces}b`)],
			['a date', () => parseDate(`Mon, 05 Jan 2026${spaces}x`)],
			['an address list', () => parseAddressList(`${'a '.repeat(n / 2)}@b ${': '.repeat(n / 2)}`)],
			['encoded words', () => decodeEncodedWords(`=?${'a'.repeat(n)} ${'=?a?q?'.repeat(n / 6)}`)],
			['comments', () => parseAddressList('('.repeat(n))],
			[
				'a whole message',
				() => parseEmail(`Subject: a${spaces}b\r\nTo: ${'<'.repeat(n)}\r\n\r\nbody`),
			],
		];
		for (const [label, run] of cases) {
			const start = performance.now();
			run();
			// Milliseconds when linear; the quadratic patterns these replaced took tens of seconds.
			expect(performance.now() - start, label).toBeLessThan(2000);
		}
	});

	it('never throws on random bytes', () => {
		fc.assert(
			fc.property(fc.uint8Array({ maxLength: 2000 }), (bytes) => {
				expect(() => parseEmail(bytes)).not.toThrow();
			}),
			{ numRuns: 300 },
		);
	});

	it('never throws on random MIME structure', () => {
		fc.assert(
			fc.property(
				fc.array(fc.constantFrom(...PIECES), { maxLength: 80 }),
				fc.boolean(),
				(lines, lf) => {
					expect(() => parseEmail(lines.join(lf ? '\n' : '\r\n'))).not.toThrow();
				},
			),
			{ numRuns: 500 },
		);
	});

	it('never throws on damaged real messages', () => {
		const samples = ['alternative-qp.eml', 'mixed-pdf.eml', 'forwarded.eml', 'related-cid.eml'].map(
			(name) => new Uint8Array(readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url))),
		);
		const damage = fc.record({
			sample: fc.nat({ max: samples.length - 1 }),
			cuts: fc.array(fc.tuple(fc.nat(), fc.nat({ max: 40 }), fc.uint8Array({ maxLength: 8 })), {
				maxLength: 6,
			}),
		});
		fc.assert(
			fc.property(damage, ({ sample, cuts }) => {
				let bytes = samples[sample]!;
				for (const [at, length, insert] of cuts) {
					const start = at % (bytes.length + 1);
					bytes = new Uint8Array([
						...bytes.subarray(0, start),
						...insert,
						...bytes.subarray(start + length),
					]);
				}
				expect(() => parseEmail(bytes)).not.toThrow();
			}),
			{ numRuns: 300 },
		);
	});
});
