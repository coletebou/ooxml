import { utf8 } from './binary';
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

	it('takes only the first part of multipart/related as a body', () => {
		const html = textPart('text/html', '<p>x</p>');
		const extra = textPart('text/plain', 'x');
		expect(bodyStructure(multi('related', html, extra)).attachments).toEqual([extra]);
	});
});

describe('messageBodies', () => {
	it('joins plain text parts and escapes plain text into the HTML body', () => {
		const root = multi(
			'mixed',
			textPart('text/plain', 'one'),
			textPart('text/html', '<p>two</p>'),
			textPart('text/plain', '3 < 4 & "5"\nsix'),
		);
		expect(messageBodies(root)).toEqual({
			text: 'one\n3 < 4 & "5"\nsix',
			html: '<div>one</div><p>two</p><div>3 &#60; 4 &#38; &#34;5&#34;<br>six</div>',
			attachments: [],
		});
	});

	it('decodes the charset and normalises line breaks to LF', () => {
		const latin = part('text/plain', {
			body: Uint8Array.of(0x63, 0x61, 0x66, 0xe9, 0x0d, 0x0a, 0x78, 0x0d),
			params: { charset: 'iso-8859-1' },
		});
		expect(messageBodies(latin).text).toBe('café\nx\n');
	});
});
