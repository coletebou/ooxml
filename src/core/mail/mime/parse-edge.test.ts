import { encodeBase64 } from '../../digest/base64';
import { utf8 } from './binary';
import { parseEmail, readEmail } from './parse';

const crlf = (lines: readonly string[]): string => lines.join('\r\n');
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe('readEmail on the messages of RFC 5322 Appendix A', () => {
	it('reads A.1.3, with groups', () => {
		const email = readEmail(
			crlf([
				'From: Pete <pete@silly.example>',
				'To: A Group:Ed Jones <c@a.test>,joe@where.test,John <jdoe@one.test>;',
				'Cc: Undisclosed recipients:;',
				'Date: Thu, 13 Feb 1969 23:32:54 -0330',
				'Message-ID: <testabcd.1234@silly.example>',
				'',
				'Testing.',
			]),
		);
		expect(email.to.map((address) => address.email)).toEqual([
			'c@a.test',
			'joe@where.test',
			'jdoe@one.test',
		]);
		expect(email.cc).toEqual([]);
		expect(email.sentAt).toBe(Date.UTC(1969, 1, 14, 3, 2, 54));
		expect(email.text).toBe('Testing.');
	});

	it('reads the threading fields of A.2', () => {
		const email = readEmail(
			crlf([
				'To: "Mary Smith: Personal Account" <smith@home.example>',
				'From: John Doe <jdoe@machine.example>',
				'Subject: Re: Saying Hello',
				'Date: Fri, 21 Nov 1997 11:00:00 -0600',
				'Message-ID: <abcd.1234@local.machine.test>',
				'In-Reply-To: <3456@example.net>',
				'References: <1234@local.machine.example> <3456@example.net>',
				'',
				'This is a reply to your reply.',
			]),
		);
		expect(email.to).toEqual([
			{ name: 'Mary Smith: Personal Account', email: 'smith@home.example' },
		]);
		expect(email.messageId).toEqual(['abcd.1234@local.machine.test']);
		expect(email.inReplyTo).toEqual(['3456@example.net']);
		expect(email.references).toEqual(['1234@local.machine.example', '3456@example.net']);
	});

	it('reads A.5, white space, comments and other oddities', () => {
		const email = readEmail(
			crlf([
				'From: Pete(A nice \\) chap) <pete(his account)@silly.test(his host)>',
				'To:A Group(Some people)',
				"     :Chris Jones <c@(Chris's host.)public.example>,",
				'         joe@example.org,',
				'  John <jdoe@one.test> (my dear friend); (the end of the group)',
				'Cc:(Empty list)(start)Hidden recipients  :(nobody(that I know))  ;',
				'Date: Thu,',
				'      13',
				'        Feb',
				'          1969',
				'      23:32',
				'               -0330 (Newfoundland Time)',
				'Message-ID:              <testabcd.1234@silly.test>',
				'',
				'Testing.',
			]),
		);
		expect(email.from).toEqual([{ name: 'Pete', email: 'pete@silly.test' }]);
		expect(email.to).toEqual([
			{ name: 'Chris Jones', email: 'c@public.example' },
			{ name: '', email: 'joe@example.org' },
			{ name: 'John', email: 'jdoe@one.test' },
		]);
		expect(email.cc).toEqual([]);
		expect(email.sentAt).toBe(Date.UTC(1969, 1, 14, 3, 2));
		expect(email.messageId).toEqual(['testabcd.1234@silly.test']);
	});

	it('reads the obsolete syntax of A.6.1 to A.6.3', () => {
		const email = readEmail(
			[
				'From  : John Doe <jdoe@machine(comment).  example>',
				'To    : Mary Smith',
				'  ',
				'          <mary@example.net>, , jdoe@test  . example',
				'Subject     : Saying Hello',
				'Date  : Fri, 21 Nov 1997 09(comment):   55  :  06 -0600',
				'Message-ID  : <1234   @   local(blah)  .machine .example>',
				'',
				'This is a message just to say hello.',
				'So, "Hello".',
			].join('\n'),
		);
		expect(email.from).toEqual([{ name: 'John Doe', email: 'jdoe@machine.example' }]);
		expect(email.to).toEqual([
			{ name: 'Mary Smith', email: 'mary@example.net' },
			{ name: '', email: 'jdoe@test.example' },
		]);
		expect(email.subject).toBe('Saying Hello');
		expect(email.sentAt).toBe(Date.UTC(1997, 10, 21, 15, 55, 6));
		expect(email.messageId).toEqual(['1234@local.machine.example']);
		expect(email.text).toBe('This is a message just to say hello.\nSo, "Hello".');
	});
});

/** A message whose body is `depth` multiparts, one inside the other, around a text part. */
function nested(depth: number): string {
	let entity = 'Content-Type: text/plain\r\n\r\ndeep text';
	for (let level = depth; level >= 1; level--)
		entity = `Content-Type: multipart/mixed; boundary="b${level}"\r\n\r\n--b${level}\r\n${entity}\r\n--b${level}--`;
	return `Subject: deep\r\n${entity}`;
}

describe('readEmail limits', () => {
	it('keeps a subtree past maxDepth as one opaque attachment', () => {
		const email = readEmail(nested(30));
		let depth = 0;
		for (let part = email.root; part.parts.length; part = part.parts[0]!) depth++;
		expect(depth).toBe(20);
		expect(email.text).toBeNull();
		expect(email.attachments).toHaveLength(1);
		expect(email.attachments[0]).toMatchObject({
			type: 'application/octet-stream',
			disposition: 'attachment',
		});
		expect(text(email.attachments[0]!.bytes)).toContain('deep text');
		expect(readEmail(nested(3), { maxDepth: 5 }).text).toBe('deep text');
		expect(readEmail(nested(3), { maxDepth: 1 }).text).toBeNull();
	});

	it('keeps the parts past maxParts as one opaque attachment', () => {
		const parts = Array.from(
			{ length: 50 },
			(_, index) =>
				`--b\r\nContent-Disposition: attachment; filename="p${index}.txt"\r\n\r\npart ${index}`,
		);
		const raw = `Subject: many\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n${parts.join('\r\n')}\r\n--b--\r\n`;
		const email = readEmail(raw, { maxParts: 10 });
		expect(email.root.parts).toHaveLength(10);
		const rest = email.root.parts[9]!;
		expect(rest.type).toBe('application/octet-stream');
		expect(text(rest.body)).toContain('part 9');
		expect(text(rest.body)).toContain('part 49');
		expect(readEmail(raw).root.parts).toHaveLength(50);
	});

	it('stops embedded messages at the same limits', () => {
		let message = 'Subject: leaf\r\n\r\nleaf text';
		for (let level = 0; level < 25; level++)
			message = `Subject: level ${level}\r\nContent-Type: message/rfc822\r\n\r\n${message}`;
		let depth = 0;
		for (let email = readEmail(message); email.root.message; email = email.root.message) depth++;
		expect(depth).toBe(20);
	});
});

describe('readEmail on other structures and malformed input', () => {
	it('reads the HTML a multipart/related `start` names, though an image comes first', () => {
		const email = readEmail(
			crlf([
				'Subject: logo',
				'Content-Type: multipart/related; boundary=r; type="text/html";',
				' start="<root@example.com>"',
				'',
				'--r',
				'Content-Type: image/png',
				'Content-ID: <logo@example.com>',
				'Content-Transfer-Encoding: base64',
				'',
				'iVBORw0KGgo=',
				'--r',
				'Content-Type: text/html; charset=utf-8',
				'Content-ID: <root@example.com>',
				'',
				'<p>Hello <img src="cid:logo@example.com"></p>',
				'--r--',
				'',
			]),
		);
		expect(email.html).toBe('<p>Hello <img src="cid:logo@example.com"></p>');
		expect(email.attachments.map((a) => [a.type, a.cid])).toEqual([
			['image/png', 'logo@example.com'],
		]);
	});

	it('gives the parts of multipart/digest the default type message/rfc822', () => {
		const email = readEmail(
			crlf([
				'Content-Type: multipart/digest; boundary=d',
				'',
				'--d',
				'',
				'Subject: first',
				'',
				'One',
				'--d',
				'Content-Type: text/plain',
				'',
				'plain',
				'--d--',
			]),
		);
		expect(email.root.parts.map((part) => part.type)).toEqual(['message/rfc822', 'text/plain']);
		expect(email.root.parts[0]!.message?.subject).toBe('first');
	});

	it('treats an unknown transfer encoding as application/octet-stream (RFC 2045 6.4)', () => {
		const email = readEmail(
			'Content-Type: text/plain\r\nContent-Transfer-Encoding: x-uuencode\r\n\r\nbegin 644 a.txt\r\n',
		);
		expect(email.root.type).toBe('application/octet-stream');
		expect(email.text).toBeNull();
		expect(email.attachments.map((attachment) => attachment.name)).toEqual(['attachment-1.bin']);
	});

	it('reads a multipart that was base64-encoded although it must not be', () => {
		const inner = '--x\r\nContent-Type: text/plain\r\n\r\nhidden text\r\n--x--';
		const raw = `Content-Type: multipart/mixed; boundary=x\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodeBase64(utf8(inner))}`;
		expect(readEmail(raw).text).toBe('hidden text');
	});

	it('reads a multipart holding only its close delimiter as empty, not as text', () => {
		const email = readEmail('Content-Type: multipart/mixed; boundary=b\r\n\r\n--b--\r\n');
		expect(email.root).toMatchObject({ partId: 'TEXT', type: 'multipart/mixed', parts: [] });
		expect(email).toMatchObject({ text: null, html: null, attachments: [] });
	});

	it('finds the delimiters of a boundary written with a trailing space', () => {
		const raw =
			'Content-Type: multipart/mixed; boundary="abc "\r\n\r\n--abc\r\n\r\nhello\r\n--abc--\r\n';
		expect(readEmail(raw).text).toBe('hello');
	});

	it('reads a multipart without a boundary, or without its delimiters, as text', () => {
		expect(readEmail('Content-Type: multipart/mixed\r\n\r\nraw body').text).toBe('raw body');
		expect(readEmail('Content-Type: multipart/mixed; boundary=zz\r\n\r\nraw body').text).toBe(
			'raw body',
		);
	});

	it('reads strings as UTF-8, and messages without a body or headers', () => {
		const email = readEmail('Subject: café\r\n\r\nbody é');
		expect(email.subject).toBe('café');
		expect(email.text).toBe('body é');
		expect(readEmail('Subject: only headers')).toMatchObject({ subject: 'only headers', text: '' });
		expect(readEmail(new Uint8Array(0))).toMatchObject({
			headers: [],
			subject: '',
			text: '',
			size: 0,
		});
		expect(readEmail('\r\njust a body')).toMatchObject({ headers: [], text: 'just a body' });
	});

	it('reads a Buffer without letting Buffer views into the result', () => {
		const email = readEmail(
			Buffer.from('Content-Type: image/png\r\nContent-Transfer-Encoding: 8bit\r\n\r\nPNG'),
		);
		expect(email.attachments[0]!.bytes.constructor).toBe(Uint8Array);
		expect(email.root.body.constructor).toBe(Uint8Array);
	});

	it('cleans directories and disguising characters out of attachment names', () => {
		const email = readEmail(
			crlf([
				'Content-Type: application/octet-stream',
				`Content-Disposition: attachment; filename="C:\\\\fakepath\\\\inv${String.fromCharCode(0x202e)}fdp.exe"`,
				'',
				'x',
			]),
		);
		expect(email.attachments[0]!.name).toBe('invfdp.exe');
	});

	it('never throws, and has nothing to hide behind its safety net', () => {
		const inputs = [
			'Content-Type: multipart/mixed; boundary=""\r\n\r\n--\r\n',
			'Content-Type: multipart/mixed; boundary=a\r\n\r\n--a\r\n--a\r\n--a--',
			'Content-Type: message/rfc822\r\n\r\n',
			'Content-Type: text/plain; charset=utf-7\r\n\r\n+AGEAYgBj-+',
			'Content-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\n====',
			'Content-Type: text/html\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n=',
			':\r\n:\r\n\r\n',
			'From: (((((((\r\nTo: """""\r\nDate: 99:99:99\r\n\r\n',
			'\u0000\u0001\u0002',
		];
		for (const input of inputs) expect(() => parseEmail(input)).not.toThrow();
		expect(() =>
			parseEmail(Uint8Array.from({ length: 4096 }, (_, index) => (index * 7919) % 256)),
		).not.toThrow();
	});
});
