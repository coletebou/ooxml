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

	it('counts an image as shown only where the reading pane shows it as a picture', () => {
		const withHtml = (html: string) =>
			toMailMessage(
				readEmail(
					writeEmail({
						from: ada,
						to: [ada],
						subject: 'Photo',
						text: 'photo',
						html,
						attachments: [
							{
								name: 'photo.png',
								type: 'image/png',
								bytes: png,
								cid: 'photo@example.com',
								inline: true,
							},
						],
					}),
				),
				meta,
				(partId) => partId,
			).hasAttachment;
		// A link to it, its name in the text or a picture in a comment shows nothing: a file to list.
		expect(withHtml('<a href="cid:photo@example.com">Download</a>')).toBe(true);
		expect(withHtml('<p>Saved as cid:photo@example.com</p>')).toBe(true);
		expect(withHtml('<!-- <img src="cid:photo@example.com"> --><p>Hi</p>')).toBe(true);
		expect(withHtml('<img data-src="cid:photo@example.com">')).toBe(true);
		// Shown in place: a picture, a background, or a style's url(), its escapes decoded.
		expect(withHtml('<p><img alt="" src="cid:photo@example.com"></p>')).toBe(false);
		expect(withHtml("<table><tr><td background='cid:Photo@Example.com'>x</td></tr></table>")).toBe(
			false,
		);
		expect(withHtml('<div style="background: url(cid:photo%40example.com)">x</div>')).toBe(false);
		expect(withHtml('<div style="background:url(&quot;cid:photo@example.com&quot;)">x</div>')).toBe(
			false,
		);
		expect(withHtml('<style>p { background: url("cid:photo@example.com") }</style>')).toBe(false);
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

	it('previews every part of an HTML body sent in several', () => {
		// Read as one text, the style the first part leaves open would take in the second.
		const parsed = readEmail(
			[
				'Content-Type: multipart/mixed; boundary=b',
				'',
				'--b',
				'Content-Type: text/html',
				'',
				'<p>Hello<style>p{color:red}',
				'--b',
				'Content-Type: text/html',
				'',
				'<p>Bye for now</p>',
				'--b--',
				'',
			].join('\r\n'),
		);
		expect(toMailMessage(parsed, meta, (partId) => partId).preview).toBe('Hello Bye for now');
	});
});
