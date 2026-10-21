import { vcard4Line } from './vcard-legacy';

describe('vcard4Line', () => {
	it('keeps every line that is neither an inline binary value nor quoted-printable as it is', () => {
		for (const line of [
			'PHOTO:data:image/jpeg;base64,/9j/4AAQ',
			'PHOTO;VALUE=uri:https://example.com/a.jpg',
			'NOTE:a=20b',
			'X-PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQ',
			'NOTE;ENCODING=b:aGk=',
			'GENDER:M',
			'no colon',
		])
			expect(vcard4Line(line)).toBe(line);
	});

	it('takes the media type from TYPE, and keeps the other parameters, quoted ones whole', () => {
		expect(vcard4Line('photo;encoding=b;type=gif:R0lG')).toBe('photo:data:image/gif;base64,R0lG');
		expect(vcard4Line('PHOTO;ENCODING=b:/9j/4AAQ')).toBe(
			'PHOTO:data:application/octet-stream;base64,/9j/4AAQ',
		);
		expect(vcard4Line('LOGO;ENCODING=b;TYPE=JPG:/9j/')).toBe('LOGO:data:image/jpeg;base64,/9j/');
		expect(vcard4Line('SOUND;BASIC;BASE64:AAAA')).toBe('SOUND:data:audio/basic;base64,AAAA');
		expect(vcard4Line('KEY;ENCODING=b;TYPE=PGP:mQIN')).toBe(
			'KEY:data:application/pgp-keys;base64,mQIN',
		);
		expect(vcard4Line('KEY;ENCODING=b;TYPE=bad type:mQIN')).toBe(
			'KEY:data:application/octet-stream;base64,mQIN',
		);
		expect(vcard4Line('PHOTO;X-LABEL="a;b:c";ENCODING=b;TYPE=PNG;PREF=1:iVBO Rw0K')).toBe(
			'PHOTO;X-LABEL="a;b:c";PREF=1:data:image/png;base64,iVBORw0K',
		);
	});

	it('writes a quoted-printable value as the text it encodes, which is how 4.0 says it', () => {
		// 3.0 dropped quoted-printable (RFC 2426 section 5); 4.0 text is UTF-8, without a CHARSET,
		// and a line break in it is `\n` (RFC 6350 sections 3.1, 3.4 and A.2).
		expect(vcard4Line('NOTE;ENCODING=QUOTED-PRINTABLE:next=20call=0D=0Aline two')).toBe(
			'NOTE:next call\\nline two',
		);
		expect(vcard4Line('ROLE;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:B=C3=BCroleitung')).toBe(
			'ROLE:Büroleitung',
		);
		expect(
			vcard4Line(
				'item1.X-LABEL;LANGUAGE=de;CHARSET=ISO-8859-1;ENCODING=QUOTED-PRINTABLE:Gr=FC=DFe',
			),
		).toBe('item1.X-LABEL;LANGUAGE=de:Grüße');
		// A decoded line break never ends the line, so no other property comes out of one.
		expect(vcard4Line('NOTE;ENCODING=QUOTED-PRINTABLE:a=0DUID:other=0Ab')).toBe(
			'NOTE:a\\nUID:other\\nb',
		);
		// An inline photo in quoted-printable is bytes, written as its `data:` URI; a link stays one.
		expect(vcard4Line('PHOTO;ENCODING=QUOTED-PRINTABLE;TYPE=GIF:GIF89a=00=FF')).toBe(
			'PHOTO:data:image/gif;base64,R0lGODlhAP8=',
		);
		expect(vcard4Line('PHOTO;VALUE=URL;ENCODING=QUOTED-PRINTABLE:https=3A//example.com/a')).toBe(
			'PHOTO;VALUE=URL:https://example.com/a',
		);
	});
});
