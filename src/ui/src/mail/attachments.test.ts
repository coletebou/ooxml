// @vitest-environment jsdom
import { render } from 'lit';
import type { MailAttachment, MailMessage } from 'ooxml-core/mail';
import { attachmentStrip } from './attachments';
import { mailI18n } from './i18n/translator';

const part = (name: string, type: string, over: Partial<MailAttachment> = {}): MailAttachment => ({
	partId: name,
	blobId: name,
	name,
	type,
	size: 10,
	disposition: 'inline',
	cid: null,
	...over,
});

type Shown = Pick<MailMessage, 'id' | 'html' | 'attachments'>;

/** The file names the strip lists for a message. */
function listed(message: Shown): string[] {
	const host = document.createElement('div');
	render(attachmentStrip(message, mailI18n('en'), { preview() {}, download() {} }), host);
	return [...host.querySelectorAll('.file-name')].map((name) => name.textContent ?? '');
}

describe('attachmentStrip', () => {
	it('lists every part but the images the HTML body shows in place', () => {
		const message: Shown = {
			id: 'm1',
			html: '<p><img src="cid:logo@x"><img src="cid:scan@x"><img src="cid:doc@x"></p><div style="background:url(cid:Back@x)">x</div><a href="cid:report@x">report</a>',
			attachments: [
				part('logo.png', 'image/png', { cid: 'logo@x' }),
				part('back.png', 'image/png', { cid: 'back@x', disposition: null }),
				// Linked, not shown: only a download can open it.
				part('report.pdf', 'application/pdf', { cid: 'report@x' }),
				// Inline but nowhere in the body.
				part('chart.png', 'image/png', { cid: 'chart@x' }),
				// Shown, but the sender attached it as a file.
				part('scan.png', 'image/png', { cid: 'scan@x', disposition: 'attachment' }),
				// Not an image: the body cannot show it, whatever points at it.
				part('doc.pdf', 'application/pdf', { cid: 'doc@x' }),
				part('notes.txt', 'text/plain', { disposition: 'attachment' }),
			],
		};
		expect(listed(message)).toEqual([
			'report.pdf',
			'chart.png',
			'scan.png',
			'doc.pdf',
			'notes.txt',
		]);
	});

	it('lists the inline parts of a message without an HTML body', () => {
		const message: Shown = {
			id: 'm2',
			html: null,
			attachments: [part('logo.png', 'image/png', { cid: 'logo@x' })],
		};
		expect(listed(message)).toEqual(['logo.png']);
	});
});
