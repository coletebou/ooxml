import email from './__fixtures__/rfc8621-email.json';
import mailbox from './__fixtures__/rfc8621-mailbox.json';
import submission from './__fixtures__/rfc8621-submission.json';
import {
	fromJmapDate,
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

describe('toMessage', () => {
	it('reads the RFC 8621 4.2.1 Email/get: the HTML of htmlBody, no text without textBody', () => {
		const [found] = listOf(email.get.response);
		const message = toMessage(found!);
		expect(message.id).toBe('f123u457');
		expect(message.receivedAt).toBe(Date.UTC(2013, 9, 13, 14, 12));
		expect(message.html).toBe('<html><body><p>Hello ...');
		expect(message.text).toBeNull();
		expect(message.attachments).toEqual([]);
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
