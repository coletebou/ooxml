import { parseVCards, serializeVCards } from './vcard';
import { vcard4Line } from './vcard-legacy';

describe('vcard4Line', () => {
	it('writes a 3.0 or 2.1 position as the geo: URI that 4.0 gives it', () => {
		// RFC 2426 3.4.2 (and 2.1, with a comma) writes two decimals; RFC 6350 6.5.2 a geo: URI.
		expect(vcard4Line('GEO:37.386013;-122.082932')).toBe('GEO:geo:37.386013,-122.082932');
		expect(vcard4Line('item1.GEO;TYPE=work:+37.24, -121.88')).toBe(
			'item1.GEO;TYPE=work:geo:37.24,-121.88',
		);
		expect(vcard4Line('GEO;VALUE=float;ENCODING=QUOTED-PRINTABLE:48=2E85;2=2E35')).toBe(
			'GEO:geo:48.85,2.35',
		);
		// A URI already, or a value that is no position, stays as it is.
		for (const line of [
			'GEO:geo:46.772673,-71.282945',
			'GEO;TYPE=work:geo:46.772673\\,-71.282945',
			'GEO:somewhere north',
			'GEO:37.38;-122.08;12',
		])
			expect(vcard4Line(line)).toBe(line);
		// Exported and read again, a card keeps its position as the URI.
		const card = 'BEGIN:VCARD\r\nVERSION:3.0\r\nUID:g\r\nFN:Ada\r\nGEO:51.5;-0.12\r\nEND:VCARD\r\n';
		const text = serializeVCards(parseVCards(card).contacts);
		expect(text).toContain('\r\nGEO:geo:51.5,-0.12\r\n');
		expect(serializeVCards(parseVCards(text).contacts)).toBe(text);
	});

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
		// A link's 2.1 value type, URL, is the one 4.0 calls uri (RFC 6350 5.2).
		expect(vcard4Line('PHOTO;VALUE=URL;ENCODING=QUOTED-PRINTABLE:https=3A//example.com/a')).toBe(
			'PHOTO;VALUE=uri:https://example.com/a',
		);
		expect(vcard4Line('item2.LOGO;value=url;X-SIZE=4:https://example.com/b')).toBe(
			'item2.LOGO;VALUE=uri;X-SIZE=4:https://example.com/b',
		);
	});
});
