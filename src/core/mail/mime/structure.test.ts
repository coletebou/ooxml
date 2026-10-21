import { utf8 } from './binary';
import { readEmail } from './parse';
import { bodyStructure, isInlineMediaType, messageBodies } from './structure';
import type { MimePart } from './types';

let counter = 0;
const part = (type: string, extra: Partial<MimePart> = {}): MimePart => ({
	partId: String(++counter),
	headers: [],
	type,
	params: {},
	disposition: null,
	name: null,
	cid: null,
	body: new Uint8Array(0),
	parts: [],
	message: null,
	...extra,
});
const multi = (subtype: string, ...parts: MimePart[]): MimePart =>
	part(`multipart/${subtype}`, { parts });
const textPart = (type: 'text/plain' | 'text/html', value: string, extra: Partial<MimePart> = {}) =>
	part(type, { body: utf8(value), params: { charset: 'utf-8' }, ...extra });

describe('isInlineMediaType', () => {
	it('is true for images, audio and video', () => {
		expect(['image/png', 'audio/ogg', 'video/mp4'].every(isInlineMediaType)).toBe(true);
		expect(isInlineMediaType('application/pdf')).toBe(false);
	});
});

describe('bodyStructure (RFC 8621 section 4.1.4)', () => {
	it('picks the text and HTML alternatives', () => {
		const plain = textPart('text/plain', 'a');
		const html = textPart('text/html', '<p>a</p>');
		expect(bodyStructure(multi('alternative', plain, html))).toEqual({
			textBody: [plain],
			htmlBody: [html],
			attachments: [],
		});
	});

	it('uses the only alternative for both bodies', () => {
		const html = textPart('text/html', '<p>a</p>');
		expect(bodyStructure(multi('alternative', html))).toMatchObject({
			textBody: [html],
			htmlBody: [html],
		});
		const plain = textPart('text/plain', 'a');
		expect(bodyStructure(multi('alternative', plain))).toMatchObject({
			textBody: [plain],
			htmlBody: [plain],
		});
		expect(bodyStructure(html)).toMatchObject({
			textBody: [html],
			htmlBody: [html],
			attachments: [],
		});
	});

	it('sorts a mixed message with related images and files', () => {
		const plain = textPart('text/plain', 'a');
		const html = textPart('text/html', '<img src="cid:i">');
		const image = part('image/png', { cid: 'i' });
		const pdf = part('application/pdf', { name: 'a.pdf', disposition: 'attachment' });
		const root = multi('mixed', multi('alternative', plain, multi('related', html, image)), pdf);
		expect(bodyStructure(root)).toEqual({
			textBody: [plain],
			htmlBody: [html],
			attachments: [image, pdf],
		});
	});

	it('keeps media between text parts in the bodies (and adds them to the attachments to show)', () => {
		const first = textPart('text/plain', 'before\n');
		const image = part('image/jpeg');
		const second = textPart('text/plain', 'after');
		const root = multi('mixed', first, image, second);
		expect(bodyStructure(root)).toEqual({
			textBody: [first, image, second],
			htmlBody: [first, image, second],
			attachments: [],
		});
		expect(messageBodies(root)).toEqual({
			text: 'before\nafter',
			html: null,
			htmlParts: null,
			attachments: [image],
		});
	});

	it('treats named text parts after the first, attachments and messages as attachments', () => {
		const body = textPart('text/plain', 'body');
		const named = textPart('text/plain', 'file', { name: 'notes.txt' });
		const forced = textPart('text/html', '<p>x</p>', { disposition: 'attachment' });
		const message = part('message/rfc822');
		const root = multi('mixed', body, named, forced, message);
		expect(bodyStructure(root).attachments).toEqual([named, forced, message]);
	});

	it('lists a part whose body an alternative higher up dropped, which the RFC would lose', () => {
		const plain = textPart('text/plain', 'a');
		const html = textPart('text/html', '<p>b</p>');
		const first = bodyStructure(multi('alternative', multi('mixed', plain, html)));
		expect(first).toEqual({ textBody: [plain], htmlBody: [plain], attachments: [html] });
		const nested = textPart('text/html', '<p>c</p>');
		const inner = multi('alternative', textPart('text/plain', 'y'), nested);
		const second = bodyStructure(
			multi('alternative', multi('mixed', textPart('text/plain', 'x'), inner)),
		);
		expect(second.attachments).toEqual([nested]);
	});

	it('lists each part of a multipart sent as an attachment, showing none (RFC 2183 2.9)', () => {
		const body = textPart('text/plain', 'body');
		const inner = textPart('text/plain', 'inner');
		const picture = part('image/png');
		const attached = part('multipart/mixed', {
			parts: [inner, multi('related', picture)],
			disposition: 'attachment',
		});
		const root = multi('mixed', body, attached);
		expect(bodyStructure(root)).toEqual({
			textBody: [body],
			htmlBody: [body],
			attachments: [inner, picture],
		});
		expect(messageBodies(root)).toMatchObject({ text: 'body', attachments: [inner, picture] });
		// Sent inline, a multipart is shown as usual.
		const shown = part('multipart/mixed', { parts: [inner], disposition: 'inline' });
		expect(bodyStructure(multi('mixed', body, shown)).textBody).toEqual([body, inner]);
	});

	it('reads a message holding a multipart sent as an attachment with that part as a file', () => {
		const parsed = readEmail(
			[
				'Content-Type: multipart/mixed; boundary=outer',
				'',
				'--outer',
				'Content-Type: text/plain',
				'',
				'Hello',
				'--outer',
				'Content-Type: multipart/mixed; boundary=inner',
				'Content-Disposition: attachment',
				'',
				'--inner',
				'Content-Type: text/plain',
				'',
				'Not for the body',
				'--inner--',
				'--outer--',
				'',
			].join('\r\n'),
		);
		expect(parsed.text).toBe('Hello');
		expect(parsed.attachments.map(({ type, size }) => [type, size])).toEqual([['text/plain', 16]]);
	});

	it('takes only the first part of multipart/related as a body', () => {
		const html = textPart('text/html', '<p>x</p>');
		const extra = textPart('text/plain', 'x');
		expect(bodyStructure(multi('related', html, extra)).attachments).toEqual([extra]);
	});

	it('takes the part `start` names as the root of multipart/related (RFC 2387)', () => {
		const image = part('image/png', { cid: 'logo@example.com' });
		const html = textPart('text/html', '<p><img src="cid:logo@example.com"></p>', {
			cid: 'root@example.com',
		});
		const related = (start: string, ...parts: MimePart[]): MimePart =>
			part('multipart/related', { parts, params: { start } });
		expect(bodyStructure(related('<root@example.com>', image, html))).toEqual({
			textBody: [html],
			htmlBody: [html],
			attachments: [image],
		});
		// Written without the angle brackets, or naming no part (then the first is the root).
		expect(bodyStructure(related('root@example.com', image, html)).htmlBody).toEqual([html]);
		expect(bodyStructure(related('<other@example.com>', html, image)).htmlBody).toEqual([html]);
		expect(bodyStructure(related('<other@example.com>', image, html)).attachments).toEqual([html]);
	});
});

describe('messageBodies', () => {
	it('escapes plain text into the HTML body, and reads no text from a text body with HTML', () => {
		const root = multi(
			'mixed',
			textPart('text/plain', 'one'),
			textPart('text/html', '<p>two</p>'),
			textPart('text/plain', '3 < 4 & "5"\nsix'),
		);
		// Its plain parts alone would leave out the HTML between them: the HTML body holds it all.
		expect(messageBodies(root)).toEqual({
			text: null,
			html: '<div>one</div><p>two</p><div>3 &#60; 4 &#38; &#34;5&#34;<br>six</div>',
			htmlParts: ['<div>one</div>', '<p>two</p>', '<div>3 &#60; 4 &#38; &#34;5&#34;<br>six</div>'],
			attachments: [],
		});
	});

	it('joins the plain text parts of a text body without HTML', () => {
		const root = multi(
			'mixed',
			textPart('text/plain', 'one'),
			textPart('text/plain', 'two\n'),
			textPart('text/plain', 'three'),
		);
		expect(messageBodies(root).text).toBe('one\ntwo\nthree');
		// After an HTML body with a plain footer, the text is not the footer alone.
		const footer = multi('mixed', textPart('text/html', '<p>Hi</p>'), textPart('text/plain', 'x'));
		expect(messageBodies(footer).text).toBeNull();
	});

	it('keeps each part of the HTML body apart, for a reader that renders each on its own', () => {
		// Parsed as one text, the open comment and the open attribute would take in what follows.
		const root = multi(
			'mixed',
			textPart('text/html', '<p>Hello<!--'),
			textPart('text/plain', 'Footer'),
			textPart('text/html', '<p title="x>Bye</p>'),
		);
		const { html, htmlParts } = messageBodies(root);
		expect(htmlParts).toEqual(['<p>Hello<!--', '<div>Footer</div>', '<p title="x>Bye</p>']);
		expect(html).toBe(htmlParts?.join(''));
		expect(messageBodies(textPart('text/plain', 'plain')).htmlParts).toBeNull();
	});

	it('decodes the charset and normalises line breaks to LF', () => {
		const latin = part('text/plain', {
			body: Uint8Array.of(0x63, 0x61, 0x66, 0xe9, 0x0d, 0x0a, 0x78, 0x0d),
			params: { charset: 'iso-8859-1' },
		});
		expect(messageBodies(latin).text).toBe('café\nx\n');
	});
});
