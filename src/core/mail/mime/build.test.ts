import { utf8 } from './binary';
import { writeEmail, type OutgoingEmail, type WriteOptions } from './build';
import { decodeEncodedWords } from './encoded-words';
import { getHeader, getHeaders } from './headers';
import { readEmail } from './parse';

const ada = { name: 'Ada Lovelace', email: 'ada@example.com' };
const grace = { name: 'Grace Hopper', email: 'grace@example.org' };
const fixed: WriteOptions = {
	boundary: (index) => `b${index}`,
	now: () => Date.UTC(2026, 0, 5, 9),
};
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const everyByte = Uint8Array.from({ length: 256 }, (_, index) => index);

describe('writeEmail', () => {
	it('writes a text-only message as one text/plain part', () => {
		const raw = writeEmail(
			{
				from: ada,
				to: [grace],
				subject: 'Hello',
				text: 'Hi Grace,\nsee you.',
				messageId: 'm1@example.com',
			},
			fixed,
		);
		expect(decode(raw)).toBe(
			[
				'Date: Mon, 05 Jan 2026 09:00:00 +0000',
				'From: Ada Lovelace <ada@example.com>',
				'To: Grace Hopper <grace@example.org>',
				'Subject: Hello',
				'Message-ID: <m1@example.com>',
				'MIME-Version: 1.0',
				'Content-Type: text/plain; charset=utf-8',
				'Content-Transfer-Encoding: 7bit',
				'',
				'Hi Grace,',
				'see you.',
			].join('\r\n'),
		);
	});

	it('writes text and HTML as multipart/alternative, quoted-printable when not plain ASCII', () => {
		const raw = decode(
			writeEmail(
				{ from: ada, to: [grace], subject: 'Hi', text: 'Hello', html: '<p>Héllo</p>' },
				fixed,
			),
		);
		expect(raw).toContain(
			'MIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=b0\r\n\r\n',
		);
		expect(raw).toContain(
			'--b0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 7bit\r\n\r\nHello\r\n--b0\r\n' +
				'Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n' +
				'<p>H=C3=A9llo</p>\r\n--b0--\r\n',
		);
	});

	it('puts images the HTML references in multipart/related and other files in multipart/mixed', () => {
		const email = readEmail(
			writeEmail(
				{
					from: ada,
					to: [grace],
					subject: 'Files',
					text: 'See the logo.',
					html: '<p><img src="CID:logo@example.com"></p>',
					attachments: [
						{ name: 'logo.png', type: 'image/png', bytes: png, cid: 'logo@example.com' },
						{ name: 'report.pdf', type: 'application/pdf', bytes: everyByte },
						{ name: 'unused.png', type: 'image/png', bytes: png, cid: 'unused@example.com' },
					],
				},
				fixed,
			),
		);
		const { root } = email;
		expect(root.type).toBe('multipart/mixed');
		expect(getHeader(root.headers, 'Content-Type')).toBe('multipart/mixed; boundary=b0');
		expect(root.parts.map((part) => part.type)).toEqual([
			'multipart/alternative',
			'application/pdf',
			'image/png',
		]);
		const [text, related] = root.parts[0]!.parts;
		expect(text!.type).toBe('text/plain');
		expect(related!.params).toEqual({ boundary: 'b2', type: 'text/html' });
		expect(related!.parts.map((part) => [part.type, part.cid, part.disposition])).toEqual([
			['text/html', null, null],
			['image/png', 'logo@example.com', 'inline'],
		]);
		expect(
			email.attachments.map((attachment) => [attachment.name, attachment.disposition]),
		).toEqual([
			['logo.png', 'inline'],
			['report.pdf', 'attachment'],
			['unused.png', 'attachment'],
		]);
	});

	it('writes Bcc only when asked, as a draft needs it and a sent copy must not show it', () => {
		const email: OutgoingEmail = {
			from: ada,
			to: [grace],
			bcc: [{ name: '', email: 'secret@example.net' }],
			subject: 'Draft',
			text: 'Not yet sent.',
		};
		expect(decode(writeEmail(email, fixed))).not.toContain('secret@');
		expect(readEmail(writeEmail(email, { ...fixed, includeBcc: true })).bcc).toEqual(email.bcc);
	});

	it('makes up a unique Message-ID and takes the Date from now() when they are missing', () => {
		const email: OutgoingEmail = { from: ada, to: [grace], subject: 's', text: 't' };
		const first = readEmail(writeEmail(email, { now: () => Date.UTC(2026, 0, 5, 9) }));
		expect(first.messageId[0]).toMatch(/^[0-9a-z]+\.[0-9a-f]{24}@example\.com$/);
		expect(first.sentAt).toBe(Date.UTC(2026, 0, 5, 9));
		const second = readEmail(writeEmail(email, { messageIdDomain: 'mail.example.net' }));
		expect(second.messageId[0]).toMatch(/@mail\.example\.net$/);
		expect(second.messageId[0]).not.toBe(first.messageId[0]);
		const local = readEmail(writeEmail({ ...email, from: { name: '', email: 'root' } }, fixed));
		expect(local.messageId[0]).toMatch(/@localhost$/);
	});

	it('keeps extra header fields but never lets them replace the ones it writes', () => {
		const raw = writeEmail(
			{
				from: ada,
				to: [grace],
				subject: 's',
				text: 't',
				headers: [
					{ name: 'X-Mailer', value: 'Test' },
					{ name: 'subject', value: 'replaced?' },
					{ name: 'Content-Type', value: 'text/html' },
					{ name: 'Bad Name', value: 'x' },
					{ name: 'X-Note', value: 'café\r\nBcc: someone@example.com' },
				],
			},
			fixed,
		);
		const email = readEmail(raw);
		expect(getHeaders(email.headers, 'Subject')).toEqual(['s']);
		expect(getHeaders(email.headers, 'Content-Type')).toEqual(['text/plain; charset=utf-8']);
		expect(getHeaders(email.headers, 'Bcc')).toEqual([]);
		expect(getHeader(email.headers, 'X-Mailer')).toBe('Test');
		expect(decodeEncodedWords(getHeader(email.headers, 'X-Note')!)).toBe(
			'café\r\nBcc: someone@example.com',
		);
		expect(decode(raw)).not.toContain('Bad Name');
	});

	it('picks a boundary that does not occur in the content', () => {
		const raw = decode(
			writeEmail(
				{ from: ada, to: [grace], subject: 's', text: 'line\n--b0\nmore', html: '<p>x</p>' },
				fixed,
			),
		);
		expect(raw).toContain('boundary=b0.1');
		expect(readEmail(raw).text).toBe('line\n--b0\nmore');
		const random = decode(
			writeEmail({ from: ada, to: [grace], subject: 's', text: 'a', html: 'b' }),
		);
		expect(random).toMatch(/boundary="=_0_[0-9a-f]{24}"/);
	});

	it('writes an empty Subject, leaves out empty id lists, and reads an impossible date as now', () => {
		const raw = decode(
			writeEmail(
				{
					from: ada,
					to: [grace],
					subject: '',
					text: 't',
					inReplyTo: [' '],
					references: [],
					date: 1e20,
				},
				fixed,
			),
		);
		expect(raw).toContain('\r\nSubject:\r\n');
		expect(raw).not.toContain('In-Reply-To');
		expect(raw).not.toContain('References');
		expect(readEmail(raw).sentAt).toBe(Date.UTC(2026, 0, 5, 9));
	});

	it('writes a file typed as a multipart as application/octet-stream', () => {
		const email = readEmail(
			writeEmail(
				{
					from: ada,
					to: [grace],
					subject: 's',
					text: 't',
					attachments: [{ name: 'parts.bin', type: 'multipart/mixed', bytes: utf8('--b\r\n') }],
				},
				fixed,
			),
		);
		expect(email.attachments.map((file) => [file.type, decode(file.bytes)])).toEqual([
			['application/octet-stream', '--b\r\n'],
		]);
	});

	it('rejects a custom boundary RFC 2046 does not allow', () => {
		const email: OutgoingEmail = { from: ada, to: [grace], subject: 's', text: 'a', html: 'b' };
		expect(() => writeEmail(email, { boundary: () => 'bad\r\nboundary' })).toThrow(RangeError);
		expect(() => writeEmail(email, { boundary: () => 'x'.repeat(71) })).toThrow(RangeError);
	});

	it('attaches a 7-bit message as it is and any other message in base64', () => {
		const inner = writeEmail({ from: grace, to: [ada], subject: 'Inner', text: 'inside' }, fixed);
		const lf = utf8('Subject: lf\n\nbody\n');
		const email = readEmail(
			writeEmail(
				{
					from: ada,
					to: [grace],
					subject: 'Fwd',
					text: 'Two messages.',
					attachments: [
						{ name: 'inner.eml', type: 'message/rfc822', bytes: inner },
						{ name: 'lf.eml', type: 'message/rfc822', bytes: lf },
					],
				},
				fixed,
			),
		);
		const [, first, second] = email.root.parts;
		expect(getHeader(first!.headers, 'Content-Transfer-Encoding')).toBe('7bit');
		expect(getHeader(second!.headers, 'Content-Transfer-Encoding')).toBe('base64');
		expect(first!.message?.subject).toBe('Inner');
		expect(second!.message?.subject).toBe('lf');
		expect(email.attachments.map((attachment) => attachment.bytes)).toEqual([inner, lf]);
	});
});

describe('writeEmail then readEmail', () => {
	const email: OutgoingEmail = {
		from: { name: 'Renée Dupont', email: 'renee@example.fr' },
		sender: { name: 'Assistant', email: 'assist@example.fr' },
		to: [ada, { name: 'Zoë, the "Countess"', email: 'zoe@example.com' }],
		cc: [{ name: '', email: 'grace@example.org' }],
		bcc: [{ name: 'Hidden Person', email: 'hidden@example.net' }],
		replyTo: [{ name: 'Équipe', email: 'team@example.fr' }],
		subject: `Réunion: le budget € 2026 et les "chiffres" ${'très longs '.repeat(8).trim()}`,
		text: `Bonjour,\n\nVoici le budget: 1 000 €.\nUne ligne très longue ${'qui continue '.repeat(20)}\n\n-- \nRenée`,
		html: '<p>Bonjour,</p>\n<p>Voici le <b>budget</b>: 1&nbsp;000 €.</p><img src="cid:chart@example.fr">',
		attachments: [
			{ name: 'chart.png', type: 'image/png', bytes: png, cid: 'chart@example.fr' },
			{ name: 'Résumé – final.pdf', type: 'application/pdf', bytes: everyByte },
			{ name: 'données.csv', type: 'text/csv; charset=utf-8', bytes: utf8('a,b\n1,2\n') },
			{ name: 'empty.bin', type: 'application/octet-stream', bytes: new Uint8Array(0) },
			{ name: 'notes.txt', type: 'text/plain', bytes: utf8('inline note'), inline: true },
		],
		messageId: 'round-trip@example.fr',
		inReplyTo: ['parent@example.com'],
		references: ['root@example.com', 'parent@example.com'],
		date: Date.UTC(2026, 9, 20, 21, 42, 7),
		headers: [{ name: 'X-Priority', value: '3' }],
	};
	const raw = writeEmail(email, { includeBcc: true });
	const parsed = readEmail(raw);

	it('reproduces the header fields, including non-ASCII names and threading', () => {
		expect(parsed.from).toEqual([email.from]);
		expect(parsed.sender).toEqual([email.sender]);
		expect(parsed.to).toEqual(email.to);
		expect(parsed.cc).toEqual(email.cc);
		expect(parsed.bcc).toEqual(email.bcc);
		expect(parsed.replyTo).toEqual(email.replyTo);
		expect(parsed.subject).toBe(email.subject);
		expect(parsed.messageId).toEqual(['round-trip@example.fr']);
		expect(parsed.inReplyTo).toEqual(email.inReplyTo);
		expect(parsed.references).toEqual(email.references);
		expect(parsed.sentAt).toBe(email.date);
		expect(getHeader(parsed.headers, 'X-Priority')).toBe('3');
	});

	it('reproduces the bodies and every attachment, names, types and bytes exactly', () => {
		expect(parsed.text).toBe(email.text);
		expect(parsed.html).toBe(email.html);
		expect(
			parsed.attachments.map(({ name, type, cid, disposition, bytes }) => ({
				name,
				type,
				cid,
				disposition,
				bytes,
			})),
		).toEqual([
			{
				name: 'chart.png',
				type: 'image/png',
				cid: 'chart@example.fr',
				disposition: 'inline',
				bytes: png,
			},
			{
				name: 'Résumé – final.pdf',
				type: 'application/pdf',
				cid: null,
				disposition: 'attachment',
				bytes: everyByte,
			},
			{
				name: 'données.csv',
				type: 'text/csv',
				cid: null,
				disposition: 'attachment',
				bytes: utf8('a,b\n1,2\n'),
			},
			{
				name: 'empty.bin',
				type: 'application/octet-stream',
				cid: null,
				disposition: 'attachment',
				bytes: new Uint8Array(0),
			},
			{
				name: 'notes.txt',
				type: 'text/plain',
				cid: null,
				disposition: 'inline',
				bytes: utf8('inline note'),
			},
		]);
		const csv = parsed.root.parts.find((part) => part.name === 'données.csv');
		expect(csv?.params.charset).toBe('utf-8');
	});

	it('writes CRLF everywhere, no line over 998 octets and every line here within 78', () => {
		const text = decode(raw);
		expect(text).not.toMatch(/\r(?!\n)|(?<!\r)\n/);
		const lines = text.split('\r\n');
		for (const line of lines) expect(utf8(line).length).toBeLessThanOrEqual(998);
		for (const line of lines) expect(line.length).toBeLessThanOrEqual(78);
		const headerLines = lines.slice(0, lines.indexOf(''));
		expect(headerLines.some((line) => /^[ \t]/.test(line))).toBe(true);
		expect(text).toContain("filename*=utf-8''donn%C3%A9es.csv");
	});
});
