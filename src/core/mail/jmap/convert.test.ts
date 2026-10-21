import email from './__fixtures__/rfc8621-email.json';
import mailbox from './__fixtures__/rfc8621-mailbox.json';
import submission from './__fixtures__/rfc8621-submission.json';
import { draftFromMessage } from '../compose';
import { readEmail, toMailMessage, type ParsedAttachment } from '../mime';
import { messageBodies } from '../mime/structure';
import type { MailAttachment } from '../model';
import {
	fromJmapDate,
	htmlBodyParts,
	objects,
	toAddresses,
	toAttachment,
	toIdentity,
	toJmapAddresses,
	toMailbox,
	toMailboxRole,
	toMessage,
	toSummary,
} from './convert';

const listOf = (response: unknown): ReturnType<typeof objects> =>
	objects(((response as unknown[])[1] as { list: unknown }).list);

describe('toMailbox', () => {
	it('reads the RFC 8621 2.6 Mailbox/get response', () => {
		expect(listOf(mailbox.getResponse).map(toMailbox)).toEqual([
			{
				id: 'MB23cfa8094c0f41e6',
				name: 'Inbox',
				parentId: null,
				role: 'inbox',
				sortOrder: 10,
				totalEmails: 16307,
				unreadEmails: 13905,
			},
			{
				id: 'MB674cc24095db49ce',
				name: 'Important mail',
				parentId: null,
				role: null,
				sortOrder: 20,
				totalEmails: 12,
				unreadEmails: 2,
			},
		]);
	});

	it('keeps the roles the model knows and drops the others', () => {
		expect(toMailboxRole('Trash')).toBe('trash');
		expect(toMailboxRole('important')).toBeNull();
		expect(toMailboxRole('all')).toBeNull();
		expect(toMailboxRole(null)).toBeNull();
		expect(toMailbox({ id: 'M', role: 'flagged', sortOrder: -3, totalEmails: 'x' })).toEqual({
			id: 'M',
			name: '',
			parentId: null,
			role: null,
			sortOrder: 0,
			totalEmails: 0,
			unreadEmails: 0,
		});
	});
});

describe('toSummary', () => {
	it('reads the RFC 8621 4.10 Email/get listing', () => {
		const [response] = listOf(email.query.response[3]);
		expect(toSummary(response!)).toEqual({
			id: 'Ma783e5cdf5f2deffbc97930a',
			threadId: 'T36703c2cfe9bd5ed',
			blobId: '',
			mailboxIds: ['fb666a55'],
			keywords: { $seen: true, $flagged: true },
			receivedAt: Date.UTC(2018, 5, 27, 0, 20, 35),
			size: 175047,
			messageId: [],
			inReplyTo: [],
			references: [],
			from: [{ name: 'Jane Doe', email: 'jdoe@example.com' }],
			to: [],
			cc: [],
			bcc: [],
			replyTo: [],
			subject: 'The Big Reveal',
			preview: expect.stringMatching(/^As you may be aware/),
			hasAttachment: true,
		});
	});

	it('turns nulls into empty lists, null names into "" and dates into UTC milliseconds', () => {
		const summary = toSummary({
			id: 'E1',
			blobId: 'B1',
			mailboxIds: { a: true, b: false },
			keywords: { $Seen: true, $draft: false },
			receivedAt: '2018-07-10T01:03:11Z',
			sentAt: '2018-07-10T11:03:11+10:00',
			messageId: ['<bbce0ae9@sloti7d1t02>'],
			inReplyTo: null,
			references: null,
			from: [{ name: null, email: 'joe@example.com' }, { name: 'No address' }],
			to: null,
			subject: null,
		});
		expect(summary).toMatchObject({
			mailboxIds: ['a'],
			keywords: { $seen: true },
			receivedAt: Date.UTC(2018, 6, 10, 1, 3, 11),
			sentAt: Date.UTC(2018, 6, 10, 1, 3, 11),
			messageId: ['bbce0ae9@sloti7d1t02'],
			inReplyTo: [],
			from: [{ name: '', email: 'joe@example.com' }],
			to: [],
			subject: '',
			hasAttachment: false,
		});
		expect(toSummary({ id: 'E2', sentAt: 'not a date' })).not.toHaveProperty('sentAt');
		expect(fromJmapDate('2014-10-30T14:12:00+08:00')).toBe(Date.UTC(2014, 9, 30, 6, 12));
		expect(fromJmapDate(12)).toBeUndefined();
	});
});

/** A raw multipart/mixed message of `parts` (header lines, a blank line, then the body). */
const mixed = (...parts: string[]): string =>
	[
		'Content-Type: multipart/mixed; boundary=b',
		'',
		...parts.flatMap((part) => ['--b', part]),
		'--b--',
		'',
	].join('\r\n');

const listed = (attachments: readonly MailAttachment[] | readonly ParsedAttachment[]) =>
	attachments.map(({ partId, name, type, disposition, cid }) => ({
		partId,
		name,
		type,
		disposition,
		cid,
	}));

describe('toMessage', () => {
	it('reads the RFC 8621 4.2.1 Email/get: htmlBody and its plain text footer, no text', () => {
		const [found] = listOf(email.get.response);
		const message = toMessage(found!);
		expect(message.id).toBe('f123u457');
		expect(message.receivedAt).toBe(Date.UTC(2013, 9, 13, 14, 12));
		// The mailing list footer is a text/plain part of htmlBody, shown after the HTML.
		expect(message.html).toBe(
			'<html><body><p>Hello ...<div>-- Sent by your friendly mailing list ...</div>',
		);
		expect(message.text).toBeNull();
		expect(message.attachments).toEqual([]);
	});

	it('keeps the plain text of htmlBody in place, escaped, as the MIME reader does', () => {
		// The lists RFC 8621 gives a multipart/mixed of these three parts: each is in both.
		const message = toMessage({
			id: 'E',
			textBody: [
				{ partId: '1', type: 'text/plain' },
				{ partId: '2', type: 'text/html' },
				{ partId: '3', type: 'text/plain' },
			],
			htmlBody: [
				{ partId: '1', type: 'text/plain' },
				{ partId: '2', type: 'text/html' },
				{ partId: '3', type: 'TEXT/PLAIN' },
			],
			bodyValues: {
				'1': { value: 'Fish & <chips>' },
				'2': { value: '<p>Menu</p>' },
				'3': { value: '-- \n"Joe"' },
			},
		});
		expect(message.html).toBe(
			'<div>Fish &#38; &#60;chips&#62;</div><p>Menu</p><div>-- <br>&#34;Joe&#34;</div>',
		);
		const parsed = readEmail(
			mixed(
				'Content-Type: text/plain\r\n\r\nFish & <chips>',
				'Content-Type: text/html\r\n\r\n<p>Menu</p>',
				'Content-Type: text/plain\r\n\r\n-- \r\n"Joe"',
			),
		);
		expect(message.html).toBe(parsed.html);
		expect(message.text).toBe(parsed.text);
	});

	it('reads no text from a text body holding HTML, as the MIME reader does', () => {
		// A message with no plain alternative and a mailing list footer: RFC 8621 lists both parts
		// in both bodies, so the plain part alone is the footer, not the message.
		const parts = [
			{ partId: '1', type: 'text/html' },
			{ partId: '2', type: 'text/plain' },
		];
		const message = toMessage({
			id: 'E',
			textBody: parts,
			htmlBody: parts,
			bodyValues: { '1': { value: '<p>Dinner on Thursday?</p>' }, '2': { value: 'The list' } },
		});
		expect(message.text).toBeNull();
		expect(message.html).toBe('<p>Dinner on Thursday?</p><div>The list</div>');
		// What prefers the text to the HTML, a reopened draft, reads the whole message so.
		expect(draftFromMessage(message, undefined).text).toBe('Dinner on Thursday?\nThe list\n');
		const parsed = readEmail(
			mixed(
				'Content-Type: text/html\r\n\r\n<p>Dinner on Thursday?</p>',
				'Content-Type: text/plain\r\n\r\nThe list',
			),
		);
		expect([parsed.text, parsed.html]).toEqual([message.text, message.html]);
	});

	it('keeps each part of the HTML body apart, as the MIME reader does', () => {
		// Parsed as one text, the open comment and the open attribute would take in what follows.
		const found = {
			id: 'E',
			htmlBody: [
				{ partId: '1', type: 'text/html' },
				{ partId: '2', type: 'text/plain' },
				{ partId: '3', type: 'text/html' },
			],
			bodyValues: {
				'1': { value: '<p>Hello<!--' },
				'2': { value: 'Footer' },
				'3': { value: '<p title="x>Bye</p>' },
			},
		};
		const parts = htmlBodyParts(found);
		expect(parts).toEqual(['<p>Hello<!--', '<div>Footer</div>', '<p title="x>Bye</p>']);
		expect(toMessage(found).html).toBe(parts?.join(''));
		const parsed = readEmail(
			mixed(
				'Content-Type: text/html\r\n\r\n<p>Hello<!--',
				'Content-Type: text/plain\r\n\r\nFooter',
				'Content-Type: text/html\r\n\r\n<p title="x>Bye</p>',
			),
		);
		expect(messageBodies(parsed.root).htmlParts).toEqual(parts);
		expect(htmlBodyParts({ id: 'E', htmlBody: [{ partId: '2', type: 'text/plain' }] })).toBeNull();
	});

	it('keeps the parts of an HTML body sent in several, and only then, as the MIME reader does', () => {
		const message = toMessage({
			id: 'E',
			htmlBody: [
				{ partId: '1', type: 'text/html' },
				{ partId: '2', type: 'text/plain' },
			],
			bodyValues: { '1': { value: '<p>Hello<!--' }, '2': { value: 'Footer' } },
		});
		expect(message.htmlParts).toEqual(['<p>Hello<!--', '<div>Footer</div>']);
		expect(message.html).toBe('<p>Hello<!--<div>Footer</div>');
		const parsed = readEmail(
			mixed(
				'Content-Type: text/html\r\n\r\n<p>Hello<!--',
				'Content-Type: text/plain\r\n\r\nFooter',
			),
		);
		const meta = { id: 'E', threadId: '', blobId: '', mailboxIds: [], keywords: {}, receivedAt: 0 };
		const read = toMailMessage(parsed, meta, (partId) => partId);
		expect([read.html, read.htmlParts]).toEqual([message.html, message.htmlParts]);
		// One part is the HTML itself.
		const single = toMessage({
			id: 'E',
			htmlBody: [{ partId: '1', type: 'text/html' }],
			bodyValues: { '1': { value: '<p>Hello</p>' } },
		});
		expect(single.html).toBe('<p>Hello</p>');
		expect(single).not.toHaveProperty('htmlParts');
	});

	it('lists the images, audio and video both bodies show, which attachments leaves out', () => {
		const photo = {
			partId: '2',
			blobId: 'B2',
			size: 3,
			name: 'photo.jpg',
			type: 'image/jpeg',
			disposition: 'inline',
			cid: '<photo@x>',
		};
		const body = [{ partId: '1', type: 'text/plain' }, photo, { partId: '3', type: 'text/plain' }];
		const withPhoto = {
			id: 'E',
			textBody: body,
			htmlBody: body,
			bodyValues: { '1': { value: 'Look:' }, '3': { value: 'Nice, right?' } },
			attachments: [],
		};
		const message = toMessage(withPhoto);
		expect(message.text).toBe('Look:\nNice, right?');
		expect(message.html).toBeNull();
		expect(message.attachments).toEqual([
			{
				partId: '2',
				blobId: 'B2',
				name: 'photo.jpg',
				type: 'image/jpeg',
				size: 3,
				disposition: 'inline',
				cid: 'photo@x',
			},
		]);
		// Listed once however many of the lists name it; after the attachments, since JMAP does
		// not say where among them a part of the bodies sits.
		const pdf = { partId: '4', blobId: 'B4', size: 9, name: 'a.pdf', type: 'application/pdf' };
		expect(toMessage({ ...withPhoto, attachments: [photo] }).attachments).toEqual(
			message.attachments,
		);
		expect(
			toMessage({ ...withPhoto, attachments: [pdf] }).attachments.map((part) => part.partId),
		).toEqual(['4', '2']);
		const parsed = readEmail(
			mixed(
				'Content-Type: text/plain\r\n\r\nLook:',
				[
					'Content-Type: image/jpeg; name=photo.jpg',
					'Content-Disposition: inline; filename=photo.jpg',
					'Content-ID: <photo@x>',
					'Content-Transfer-Encoding: base64',
					'',
					'/9j/',
				].join('\r\n'),
				'Content-Type: text/plain\r\n\r\nNice, right?',
			),
		);
		expect(message.text).toBe(parsed.text);
		expect(message.html).toBe(parsed.html);
		expect(listed(message.attachments)).toEqual(listed(parsed.attachments));
	});

	it('cleans attachment names as the MIME reader does', () => {
		const RLO = String.fromCharCode(0x202e);
		const name = (value: unknown): string => toAttachment({ blobId: 'B', name: value }).name;
		expect(name(`invoice${RLO}fdp.exe`)).toBe('invoicefdp.exe');
		expect(name('../../etc/passwd')).toBe('passwd');
		expect(name('C:\\fakepath\\report.pdf')).toBe('report.pdf');
		expect(name('a\u0000b\tc.txt')).toBe('a b c.txt');
		expect(name('Résumé.pdf')).toBe('Résumé.pdf');
		expect(name('folder/')).toBe('');
		expect(name(null)).toBe('');
		const message = toMessage({
			id: 'E',
			attachments: [{ partId: '2', blobId: 'B2', type: 'application/pdf', name: `x${RLO}fdp.exe` }],
		});
		expect(message.attachments[0]!.name).toBe('xfdp.exe');
		// The MIME reader decodes the same name (RFC 2231) and cleans it the same way.
		const parsed = readEmail(
			mixed(
				'Content-Type: text/plain\r\n\r\nSee the file.',
				[
					'Content-Type: application/pdf',
					"Content-Disposition: attachment; filename*=utf-8''x%E2%80%AEfdp.exe",
					'',
					'%PDF',
				].join('\r\n'),
			),
		);
		expect(parsed.attachments.map((attachment) => attachment.name)).toEqual(['xfdp.exe']);
	});

	it('joins text parts, keeps HTML null without an HTML part and lists attachments', () => {
		const message = toMessage({
			id: 'E',
			textBody: [
				{ partId: '1', type: 'text/plain' },
				{ partId: '3', type: 'image/png' },
				{ partId: '2', type: 'TEXT/PLAIN' },
				// Only the values the server sent count, never inherited object members.
				{ partId: 'toString', type: 'text/plain' },
			],
			htmlBody: [{ partId: '1', type: 'text/plain' }],
			bodyValues: { '1': { value: 'Hello' }, '2': { value: '-- \nfooter' } },
			attachments: [
				{
					partId: '3',
					blobId: 'B3',
					size: 5,
					name: 'dot.png',
					type: 'IMAGE/PNG',
					disposition: 'inline',
					cid: '<dot@x>',
				},
				{
					partId: '4',
					blobId: 'B4',
					size: 9,
					name: 'a.pdf',
					type: 'application/pdf',
					disposition: 'attachment',
				},
				{ partId: '5', blobId: null, type: 'text/plain' },
			],
		});
		expect(message.text).toBe('Hello\n-- \nfooter');
		expect(message.html).toBeNull();
		expect(message.attachments).toEqual([
			{
				partId: '3',
				blobId: 'B3',
				name: 'dot.png',
				type: 'image/png',
				size: 5,
				disposition: 'inline',
				cid: 'dot@x',
			},
			{
				partId: '4',
				blobId: 'B4',
				name: 'a.pdf',
				type: 'application/pdf',
				size: 9,
				disposition: 'attachment',
				cid: null,
			},
		]);
		expect(toAttachment({ blobId: 'B', disposition: 'form-data' }).disposition).toBe('attachment');
		expect(toAttachment({ blobId: 'B' })).toMatchObject({
			disposition: null,
			type: 'application/octet-stream',
		});
	});
});

describe('toIdentity', () => {
	it('reads the RFC 8621 6.4 Identity/get response', () => {
		expect(listOf(submission.identityResponse).map(toIdentity)).toEqual([
			{
				id: 'XD-3301-222-11_22AAz',
				name: 'Joe Bloggs',
				email: 'joe@example.com',
				replyTo: [],
				bcc: [{ name: '', email: 'joe+archive@example.com' }],
				textSignature: '-- \nJoe Bloggs\nMaster of Email',
				htmlSignature: '<div><b>Joe Bloggs</b></div><div>Master of Email</div>',
			},
			{
				id: 'XD-9911312-11_22AAz',
				name: 'Joe B',
				email: '*@example.com',
				replyTo: [],
				bcc: [],
				textSignature: '',
				htmlSignature: '',
			},
		]);
	});
});

describe('addresses', () => {
	it('round-trips, an empty name going out as null', () => {
		const list = [
			{ name: 'Ada Lovelace', email: 'ada@example.com' },
			{ name: '', email: 'grace@example.com' },
		];
		expect(toJmapAddresses(list)).toEqual([
			{ name: 'Ada Lovelace', email: 'ada@example.com' },
			{ name: null, email: 'grace@example.com' },
		]);
		expect(toAddresses(toJmapAddresses(list))).toEqual(list);
		expect(toAddresses(null)).toEqual([]);
	});

	it('only trusts list items that are objects with an id', () => {
		expect(objects([{ id: 'a' }, { id: 3 }, null, 'b', [1]])).toEqual([{ id: 'a' }]);
		expect(objects(undefined)).toEqual([]);
	});
});
