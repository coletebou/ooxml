import { writeEmail } from './build';
import { toMailMessage } from './message';
import { readEmail } from './parse';

const meta = {
	id: 'm1',
	threadId: 't1',
	blobId: 'raw-1',
	mailboxIds: ['inbox'],
	keywords: { $seen: true } as Record<string, true>,
	receivedAt: Date.UTC(2026, 0, 5, 10),
};
const ada = { name: 'Ada Lovelace', email: 'ada@example.com' };
const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47);

describe('toMailMessage', () => {
	it('maps a parsed message onto the mail model', () => {
		const parsed = readEmail(
			writeEmail(
				{
					from: ada,
					to: [{ name: '', email: 'grace@example.org' }],
					subject: 'Plans',
					text: '  Hello   Grace,\n\nthe plans.  ',
					attachments: [{ name: 'plan.pdf', type: 'application/pdf', bytes: png }],
					messageId: 'plans@example.com',
					references: ['root@example.com'],
					date: Date.UTC(2026, 0, 5, 9),
				},
				{ boundary: (index) => `b${index}` },
			),
		);
		const message = toMailMessage(parsed, meta, (partId) => `blob-${partId}`);
		expect(message).toEqual({
			id: 'm1',
			threadId: 't1',
			blobId: 'raw-1',
			mailboxIds: ['inbox'],
			keywords: { $seen: true },
			receivedAt: Date.UTC(2026, 0, 5, 10),
			sentAt: Date.UTC(2026, 0, 5, 9),
			size: parsed.size,
			messageId: ['plans@example.com'],
			inReplyTo: [],
			references: ['root@example.com'],
			from: [ada],
			to: [{ name: '', email: 'grace@example.org' }],
			cc: [],
			bcc: [],
			replyTo: [],
			subject: 'Plans',
			preview: 'Hello Grace, the plans.',
			hasAttachment: true,
			text: '  Hello   Grace,\n\nthe plans.  ',
			html: null,
			attachments: [
				{
					partId: '2',
					blobId: 'blob-2',
					name: 'plan.pdf',
					type: 'application/pdf',
					size: 4,
					disposition: 'attachment',
					cid: null,
				},
			],
		});
		expect(message.mailboxIds).not.toBe(meta.mailboxIds);
	});

	it('leaves sentAt out without a Date, and prefers the stored size', () => {
		const parsed = readEmail('Subject: no date\r\n\r\nbody');
		const message = toMailMessage(parsed, { ...meta, size: 999 }, (partId) => partId);
		expect('sentAt' in message).toBe(false);
		expect(message.size).toBe(999);
	});

	it('previews the HTML without tags, scripts or styles when there is no text', () => {
		const parsed = readEmail(
			'Content-Type: text/html\r\n\r\n<style>p{color:red}</style><p>Hello&nbsp;<b>Grace</b></p><script>alert(1)</script>',
		);
		expect(toMailMessage(parsed, meta, (partId) => partId).preview).toBe('Hello Grace');
	});

	it('does not count an image the HTML shows as an attachment', () => {
		const shown = (html: string) =>
			toMailMessage(
				readEmail(
					writeEmail({
						from: ada,
						to: [ada],
						subject: 'Logo',
						text: 'logo',
						html,
						attachments: [
							{ name: 'logo.png', type: 'image/png', bytes: png, cid: 'logo@example.com' },
						],
					}),
				),
				meta,
				(partId) => partId,
			).hasAttachment;
		expect(shown('<img src="cid:logo@example.com">')).toBe(false);
		expect(shown('<p>no reference</p>')).toBe(true);
	});

	it('keeps the parts of an HTML body sent in several, and only then', () => {
		const parsed = readEmail(
			[
				'Content-Type: multipart/mixed; boundary=b',
				'',
				'--b',
				'Content-Type: text/html',
				'',
				'<p>Hello<!--',
				'--b',
				'Content-Type: text/html',
				'',
				'<p>Bye</p>',
				'--b--',
				'',
			].join('\r\n'),
		);
		const message = toMailMessage(parsed, meta, (partId) => partId);
		expect(message.htmlParts).toEqual(['<p>Hello<!--', '<p>Bye</p>']);
		expect(message.html).toBe('<p>Hello<!--<p>Bye</p>');
		// One part is the HTML itself.
		const single = toMailMessage(
			readEmail('Content-Type: text/html\r\n\r\n<p>Hello</p>'),
			meta,
			(partId) => partId,
		);
		expect(single.html).toBe('<p>Hello</p>');
		expect(single).not.toHaveProperty('htmlParts');
	});
});
