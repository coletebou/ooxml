import { readFileSync } from 'node:fs';
import { getHeader } from './headers';
import { readEmail } from './parse';
import type { ParsedAttachment } from './types';

const fixture = (name: string): Uint8Array =>
	readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url));
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const ids = (part: { partId: string; parts: readonly { partId: string }[] }): string[] =>
	part.parts.map((child) => child.partId);
/** An attachment without its bytes, to compare the rest at once. */
const described = ({ partId, name, type, size, disposition, cid }: ParsedAttachment) => ({
	partId,
	name,
	type,
	size,
	disposition,
	cid,
});

describe('readEmail on saved messages', () => {
	it('reads a plain message (CRLF)', () => {
		const bytes = fixture('plain.eml');
		const email = readEmail(bytes);
		expect(email.from).toEqual([{ name: 'Ada Lovelace', email: 'ada@example.com' }]);
		expect(email.to).toEqual([{ name: 'Grace Hopper', email: 'grace@example.org' }]);
		expect(email.subject).toBe('Notes on the analytical engine');
		expect(email.sentAt).toBe(Date.UTC(2026, 0, 5, 9));
		expect(email.messageId).toEqual(['note-1@example.com']);
		expect(email.inReplyTo).toEqual([]);
		expect(email.text).toBe(
			'Dear Grace,\n\nThe engine can arrange and combine its numerical quantities\nexactly as if they were letters or any other general symbols.\n\nAda\n',
		);
		expect(email.html).toBeNull();
		expect(email.attachments).toEqual([]);
		expect(email.root).toMatchObject({ partId: '1', type: 'text/plain', parts: [], message: null });
		expect(email.headers).toHaveLength(10);
		expect(getHeader(email.headers, 'received')).toBe(
			'from mail.example.net (mail.example.net [192.0.2.1])\tby mx.example.org with ESMTPS id abc123\tfor <grace@example.org>; Mon, 05 Jan 2026 09:00:02 +0000',
		);
		expect(email.size).toBe(bytes.length);
	});

	it('reads multipart/alternative with quoted-printable, encoded words and a group', () => {
		const email = readEmail(fixture('alternative-qp.eml'));
		expect(email.from).toEqual([{ name: 'Renée Dupont', email: 'renee@example.fr' }]);
		expect(email.to).toEqual([
			{ name: 'Lovelace, Ada', email: 'ada@example.com' },
			{ name: '', email: 'bob@example.org' },
		]);
		expect(email.cc).toEqual([
			{ name: '', email: 'carol@example.net' },
			{ name: 'Dan', email: 'dan@example.net' },
		]);
		expect(email.subject).toBe("Réunion de l'équipe € budget");
		expect(email.sentAt).toBe(Date.UTC(2026, 0, 6, 13, 30));
		expect(email.inReplyTo).toEqual(['note-1@example.com']);
		expect(email.references).toEqual(['root@example.com', 'note-1@example.com']);
		expect(email.text).toBe(
			'Bonjour à tous,\n\nLe budget est de 1€. Cette ligne est très longue et elle est coupée par un saut de ligne doux.\n\nÀ bientôt',
		);
		expect(email.html).toBe(
			'<html><body><p>Bonjour à tous,</p><p>Le budget est de 1€.</p></body></html>',
		);
		expect(email.root.partId).toBe('TEXT');
		expect(ids(email.root)).toEqual(['1', '2']);
		expect(email.attachments).toEqual([]);
	});

	it('reads multipart/mixed with a base64 binary attachment and an RFC 2231 name', () => {
		const email = readEmail(fixture('mixed-pdf.eml'));
		const pdf = new Uint8Array([
			...new TextEncoder().encode('%PDF-1.4\n'),
			...Array.from({ length: 256 }, (_, index) => index),
			...new TextEncoder().encode('\n%%EOF\n'),
		]);
		expect(email.sentAt).toBe(Date.UTC(2026, 0, 7, 13, 15, 30));
		expect(email.text).toBe('The report is attached, with the figures.');
		expect(email.attachments.map(described)).toEqual([
			{
				partId: '2',
				name: 'Résumé final 2026.pdf',
				type: 'application/pdf',
				size: pdf.length,
				disposition: 'attachment',
				cid: null,
			},
			{
				partId: '3',
				name: 'attachment-2.csv',
				type: 'text/csv',
				size: 26,
				disposition: 'attachment',
				cid: null,
			},
		]);
		expect(email.attachments[0]!.bytes).toEqual(pdf);
		expect(text(email.attachments[1]!.bytes)).toBe('name,amount\nAda,3\nGrace,5\n');
		expect(email.root.parts[1]!.name).toBe('Résumé final 2026.pdf');
	});

	it('reads multipart/related with a cid image (LF line endings)', () => {
		const email = readEmail(fixture('related-cid.eml'));
		expect(email.text).toBe('Here is the new logo.');
		expect(email.html).toBe(
			'<p>Here is the new logo: <img src="cid:logo@example.com" alt="logo"></p>',
		);
		expect(ids(email.root)).toEqual(['1', '2']);
		expect(ids(email.root.parts[1]!)).toEqual(['2.1', '2.2']);
		expect(email.attachments).toHaveLength(1);
		const [logo] = email.attachments;
		expect(logo).toMatchObject({
			partId: '2.2',
			name: 'attachment-1.png',
			type: 'image/png',
			disposition: null,
			cid: 'logo@example.com',
		});
		const png =
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
		expect(logo!.bytes).toEqual(new Uint8Array(Buffer.from(png, 'base64')));
	});

	it('reads a forwarded message/rfc822 attachment, numbering its parts inside it', () => {
		const email = readEmail(fixture('forwarded.eml'));
		expect(email.text).toBe('See the message below.');
		expect(email.attachments.map(described)).toEqual([
			{
				partId: '2',
				name: 'Planning.eml',
				type: 'message/rfc822',
				size: email.root.parts[1]!.body.length,
				disposition: 'inline',
				cid: null,
			},
		]);
		const inner = email.root.parts[1]!.message!;
		expect(inner.subject).toBe('Planning');
		expect(inner.from).toEqual([{ name: 'Ada Lovelace', email: 'ada@example.com' }]);
		expect(inner.messageId).toEqual(['inner-1@example.com']);
		expect(inner.text).toBe('The plan for next week.');
		expect(inner.html).toBe('<p>The plan for next week.</p>');
		expect(inner.root.partId).toBe('2.TEXT');
		expect(ids(inner.root)).toEqual(['2.1', '2.2']);
		expect(ids(inner.root.parts[0]!)).toEqual(['2.1.1', '2.1.2']);
		expect(inner.attachments.map((attachment) => [attachment.partId, attachment.name])).toEqual([
			['2.2', 'agenda.txt'],
		]);
		expect(text(inner.attachments[0]!.bytes)).toBe('1. Engines\r\n2. Tables');
		expect(text(email.attachments[0]!.bytes).startsWith('From: Ada Lovelace')).toBe(true);
	});

	it('reads an iso-8859-1 message with obsolete date and encoded words', () => {
		const email = readEmail(fixture('latin1.eml'));
		expect(email.from).toEqual([{ name: 'André Pirard', email: 'andre@example.be' }]);
		expect(email.to).toEqual([{ name: 'Keld Jørn Simonsen', email: 'keld@example.dk' }]);
		expect(email.subject).toBe('Café crème');
		expect(email.sentAt).toBe(Date.UTC(1997, 10, 21, 9, 55, 6));
		expect(email.text).toBe("Un café crème, s'il vous plaît.\nÀ bientôt.\n");
	});

	it('reads a windows-1252 message, the charset of most 8-bit mail', () => {
		const email = readEmail(fixture('windows-1252.eml'));
		expect(email.subject).toBe('“Smart” quotes – and €');
		expect(email.sentAt).toBe(Date.UTC(2026, 0, 10, 17));
		expect(email.text).toBe('It costs €20 – or so they say…\n“Quoted” text.\n');
	});

	it('reads a malformed message as far as it goes', () => {
		const email = readEmail(fixture('malformed.eml'));
		expect(email.from).toEqual([{ name: 'Broken Sender', email: 'broken@example.com' }]);
		expect(email.to).toEqual([
			{ name: '', email: 'valid@example.com' },
			{ name: '', email: 'also@example.com' },
		]);
		expect(email.subject).toBe('=?utf-8?B?not*valid*base64?= and café');
		expect(email.sentAt).toBeUndefined();
		expect(email.text).toBe(
			'Café with a bad charset, a broken escape =ZZ and a soft break at the end\nno boundary here\n',
		);
		expect(email.attachments.map((attachment) => [attachment.partId, attachment.name])).toEqual([
			['2', 'truncated.bin'],
		]);
		expect(text(email.attachments[0]!.bytes)).toBe('Hello, world!Hello again');
		expect(email.root.parts.map((part) => part.type)).toEqual([
			'text/plain',
			'application/octet-stream',
			'text/plain',
		]);
	});
});

describe('readEmail on an HTML body in several parts', () => {
	it('keeps each part as well as the parts joined', () => {
		// Parsed as one text, the comment the first part leaves open would take in the others.
		const email = readEmail(
			[
				'Content-Type: multipart/mixed; boundary=b',
				'',
				'--b',
				'Content-Type: text/html',
				'',
				'<p>Hello<!--',
				'--b',
				'Content-Type: text/plain',
				'',
				'Footer',
				'--b',
				'Content-Type: text/html',
				'',
				'<p>Bye</p>',
				'--b--',
				'',
			].join('\r\n'),
		);
		expect(email.htmlParts).toEqual(['<p>Hello<!--', '<div>Footer</div>', '<p>Bye</p>']);
		expect(email.html).toBe('<p>Hello<!--<div>Footer</div><p>Bye</p>');
		const single = readEmail(fixture('alternative-qp.eml'));
		expect(single.htmlParts).toEqual([single.html]);
		expect(readEmail(fixture('plain.eml')).htmlParts).toBeNull();
	});
});
