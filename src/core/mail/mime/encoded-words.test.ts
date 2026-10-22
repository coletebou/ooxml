import { decodeEncodedWords, encodeHeaderText, encodePhrase } from './encoded-words';

describe('decodeEncodedWords', () => {
	it('decodes the header examples of RFC 2047 section 8', () => {
		expect(decodeEncodedWords('=?US-ASCII?Q?Keith_Moore?= <moore@cs.utk.edu>')).toBe(
			'Keith Moore <moore@cs.utk.edu>',
		);
		expect(decodeEncodedWords('=?ISO-8859-1?Q?Keld_J=F8rn_Simonsen?= <keld@dkuug.dk>')).toBe(
			'Keld Jørn Simonsen <keld@dkuug.dk>',
		);
		expect(decodeEncodedWords('=?ISO-8859-1?Q?Andr=E9?= Pirard <PIRARD@vm1.ulg.ac.be>')).toBe(
			'André Pirard <PIRARD@vm1.ulg.ac.be>',
		);
		expect(
			decodeEncodedWords(
				'=?ISO-8859-1?B?SWYgeW91IGNhbiByZWFkIHRoaXMgeW8=?=\r\n    =?ISO-8859-2?B?dSB1bmRlcnN0YW5kIHRoZSBleGFtcGxlLg==?=',
			),
		).toBe('If you can read this you understand the example.');
		expect(decodeEncodedWords('=?ISO-8859-1?Q?Olle_J=E4rnefors?=')).toBe('Olle Järnefors');
		expect(decodeEncodedWords('=?ISO-8859-1?Q?Patrik_F=E4ltstr=F6m?=')).toBe('Patrik Fältström');
		expect(decodeEncodedWords('Nathaniel Borenstein (=?iso-8859-8?b?7eXs+SDv4SDp7Oj08A==?=)')).toBe(
			'Nathaniel Borenstein (םולש ןב ילטפנ)',
		);
	});

	it('joins adjacent encoded words as the section 8 table shows', () => {
		const cases: Array<[string, string]> = [
			['(=?ISO-8859-1?Q?a?=)', '(a)'],
			['(=?ISO-8859-1?Q?a?= b)', '(a b)'],
			['(=?ISO-8859-1?Q?a?= =?ISO-8859-1?Q?b?=)', '(ab)'],
			['(=?ISO-8859-1?Q?a?=  =?ISO-8859-1?Q?b?=)', '(ab)'],
			['(=?ISO-8859-1?Q?a?=\r\n    =?ISO-8859-1?Q?b?=)', '(ab)'],
			['(=?ISO-8859-1?Q?a_b?=)', '(a b)'],
			['(=?ISO-8859-1?Q?a?= =?ISO-8859-2?Q?_b?=)', '(a b)'],
		];
		for (const [input, output] of cases) expect(decodeEncodedWords(input)).toBe(output);
	});

	it('reads the RFC 2231 language suffix and lower-case encodings', () => {
		expect(decodeEncodedWords('=?US-ASCII*EN?Q?Keith_Moore?=')).toBe('Keith Moore');
		expect(decodeEncodedWords('=?utf-8?b?w6k=?= =?utf-8?q?=C3=A9?=')).toBe('éé');
	});

	it('decodes a character an encoder split across two words', () => {
		expect(decodeEncodedWords('=?UTF-8?Q?caf=C3?= =?UTF-8?Q?=A9?=')).toBe('café');
		expect(decodeEncodedWords('=?UTF-8?B?4oI=?= =?UTF-8?B?rA==?=')).toBe('€');
	});

	it('leaves malformed words and plain text as written, keeping their white space', () => {
		expect(decodeEncodedWords('=?UTF-8?B?***?= =?UTF-8?Q?a?=')).toBe('=?UTF-8?B?***?= a');
		expect(decodeEncodedWords('=?UTF-8?X?abc?=')).toBe('=?UTF-8?X?abc?=');
		expect(decodeEncodedWords('1 =? 2 ?= 3')).toBe('1 =? 2 ?= 3');
		expect(decodeEncodedWords('no words here')).toBe('no words here');
	});

	it('finds words inside other text and quotes, as mail programs read them', () => {
		expect(decodeEncodedWords('"=?UTF-8?Q?Ren=C3=A9e?=" <r@example.fr>')).toBe(
			'"Renée" <r@example.fr>',
		);
		expect(decodeEncodedWords('re:=?UTF-8?Q?caf=C3=A9?=')).toBe('re:café');
	});

	it('reads an unknown charset as UTF-8 when valid, else windows-1252', () => {
		expect(decodeEncodedWords('=?x-unknown?Q?caf=E9?=')).toBe('café');
		expect(decodeEncodedWords('=?x-unknown?Q?caf=C3=A9?=')).toBe('café');
	});
});

describe('encodeHeaderText', () => {
	it('leaves printable ASCII as it is', () => {
		expect(encodeHeaderText('Notes on the engine (draft)')).toBe('Notes on the engine (draft)');
	});

	it('encodes only the runs of words that need it, the white space inside a run with them', () => {
		expect(encodeHeaderText('Re: Réunionnaires meeting')).toBe(
			'Re: =?UTF-8?Q?R=C3=A9unionnaires?= meeting',
		);
		expect(encodeHeaderText('café crème')).toBe('=?UTF-8?B?Y2Fmw6kgY3LDqG1l?=');
		expect(decodeEncodedWords(encodeHeaderText('café and  crème'))).toBe('café and  crème');
	});

	it('writes B or Q, whichever is shorter, Q on a tie', () => {
		// Q `caf=C3=A9` is 21 characters as a word, B `Y2Fmw6k=` 20.
		expect(encodeHeaderText('café')).toBe('=?UTF-8?B?Y2Fmw6k=?=');
		expect(encodeHeaderText('Réunionnaires')).toBe('=?UTF-8?Q?R=C3=A9unionnaires?=');
		// `R=C3=A9union` and `UsOpdW5pb24=` are both 12 characters.
		expect(encodeHeaderText('Réunion')).toBe('=?UTF-8?Q?R=C3=A9union?=');
		expect(encodeHeaderText('Dupont, Renée')).toBe('Dupont, =?UTF-8?B?UmVuw6ll?=');
	});

	it('encodes text a reader would take for an encoded word', () => {
		const text = 'see =?UTF-8?Q?x?= here';
		expect(encodeHeaderText(text)).not.toContain('=?UTF-8?Q?x?=');
		expect(decodeEncodedWords(encodeHeaderText(text))).toBe(text);
	});

	it('picks B when it is shorter and keeps every word within 66 characters', () => {
		const greek = 'Καλημέρα κόσμε, '.repeat(6).trim();
		const encoded = encodeHeaderText(greek);
		expect(encoded.startsWith('=?UTF-8?B?')).toBe(true);
		for (const word of encoded.split(' ')) expect(word.length).toBeLessThanOrEqual(66);
		expect(decodeEncodedWords(encoded)).toBe(greek);
	});

	it('never splits a UTF-8 sequence or a surrogate pair between words', () => {
		const text = `${'😀'.repeat(20)}é${'𝄞'.repeat(20)}`;
		const encoded = encodeHeaderText(text);
		expect(encoded.split(' ').length).toBeGreaterThan(1);
		for (const word of encoded.split(' ')) expect(decodeEncodedWords(word)).not.toContain('�');
		expect(decodeEncodedWords(encoded)).toBe(text);
	});

	it('encodes control characters and line breaks instead of writing them', () => {
		const encoded = encodeHeaderText('one\r\ntwo\u0000');
		expect(encoded).not.toMatch(/[\r\n\u0000]/);
		expect(decodeEncodedWords(encoded)).toBe('one\r\ntwo\u0000');
	});
});

describe('encodePhrase', () => {
	it('writes atoms bare, other printable ASCII quoted, and the rest as encoded words', () => {
		expect(encodePhrase('Ada Lovelace')).toBe('Ada Lovelace');
		expect(encodePhrase('Lovelace, Ada')).toBe('"Lovelace, Ada"');
		expect(encodePhrase('Joe Q. Public')).toBe('"Joe Q. Public"');
		expect(encodePhrase('Ada  Lovelace')).toBe('"Ada  Lovelace"');
		expect(encodePhrase('Giant; "Big" Box')).toBe('"Giant; \\"Big\\" Box"');
		expect(encodePhrase('Renée Dupont')).toBe('=?UTF-8?Q?Ren=C3=A9e_Dupont?=');
		expect(encodePhrase('Dupont, Renée')).toBe('=?UTF-8?Q?Dupont=2C_Ren=C3=A9e?=');
		expect(encodePhrase('')).toBe('');
	});
});
