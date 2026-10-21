import { describe, expect, it } from 'vitest';
import { decodeHtmlCharacterReferences as decode } from './html-character-references';

describe('decodeHtmlCharacterReferences', () => {
	it('decodes every named reference of HTML', () => {
		expect(decode('Caf&eacute; cr&egrave;me &hellip; &mdash; &rsquo;&euro;')).toBe(
			'Café crème … \u2014 ’€',
		);
		// Names are case-sensitive, and a reference may stand for two code points.
		expect(decode('&Eacute;&eacute; &AMP;&Amp; &fjlig; &NotEqualTilde;')).toBe(
			'Éé &&Amp; fj \u2242\u0338',
		);
		// A no-break space is the character it names.
		expect(decode('a&nbsp;b&NonBreakingSpace;c')).toBe('a\u00a0b\u00a0c');
	});

	it('takes an older name without its semicolon unless a letter, a digit or = follows', () => {
		expect(decode('&copy 2026 caf&eacute. &copyright ?a=1&amp=2 &amp')).toBe(
			'© 2026 café. &copyright ?a=1&amp=2 &',
		);
		// A newer name always needs it.
		expect(decode('&hellip &hellip;')).toBe('&hellip …');
	});

	it('leaves what is no reference as written', () => {
		expect(decode('&bogus; & a &; &#; &#x; &#xg; AT&T')).toBe('&bogus; & a &; &#; &#x; &#xg; AT&T');
	});

	it('decodes numeric references as the HTML Standard does, with or without the semicolon', () => {
		expect(decode('&#65;&#x42;&#X43; &#68&#x45 &#00070;')).toBe('ABC DE F');
		// No character, no surrogate half and nothing past Unicode: the replacement character.
		expect(decode('&#0; &#xD800; &#xDFFF; &#x110000; &#99999999999999999999;')).toBe(
			'\ufffd \ufffd \ufffd \ufffd \ufffd',
		);
		// A noncharacter or a control stays what it is.
		expect(decode('&#xFFFE;&#13;&#x7F;')).toBe('\ufffe\r\u007f');
	});

	it('reads a numeric reference to 0x80 to 0x9F as windows-1252, as the HTML Standard does', () => {
		const windows1252 = new TextDecoder('windows-1252');
		for (let code = 0x80; code <= 0x9f; code++)
			expect(decode(`&#${code};`), code.toString(16)).toBe(windows1252.decode(Uint8Array.of(code)));
		expect(decode('&#150; &#x92;')).toBe('– ’');
	});
});
