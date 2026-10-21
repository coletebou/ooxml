import { vcard4Line } from './vcard-legacy';

describe('vcard4Line', () => {
	it('keeps every line that is not an inline binary photo, logo, sound or key as it is', () => {
		for (const line of [
			'PHOTO:data:image/jpeg;base64,/9j/4AAQ',
			'PHOTO;VALUE=uri:https://example.com/a.jpg',
			'PHOTO;ENCODING=QUOTED-PRINTABLE:abc',
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
});
