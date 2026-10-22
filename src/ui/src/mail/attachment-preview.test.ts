// @vitest-environment jsdom
import { defineMailAttachmentPreview, type MailAttachmentPreview } from './attachment-preview';
import type { OpenAttachmentDetail } from './mail-app';

beforeAll(() => defineMailAttachmentPreview());
afterEach(() => document.body.replaceChildren());

const notes: OpenAttachmentDetail = {
	emailId: 'm1',
	attachment: {
		partId: '2',
		blobId: 'b1',
		name: 'notes.txt',
		type: 'text/plain',
		size: 5,
		disposition: 'attachment',
		cid: null,
	},
	bytes: new TextEncoder().encode('hello'),
};
const key = (name: string, init: KeyboardEventInit = {}) =>
	new KeyboardEvent('keydown', {
		key: name,
		bubbles: true,
		composed: true,
		cancelable: true,
		...init,
	});

describe('<mail-attachment-preview>', () => {
	it('takes the focus, keeps Tab inside, closes with Escape and gives the focus back', async () => {
		const opener = document.createElement('button');
		const host = document.createElement('div');
		const reached: string[] = [];
		host.addEventListener('keydown', (e) => reached.push(e.key));
		document.body.append(opener, host);
		opener.focus();
		const el = document.createElement('mail-attachment-preview') as MailAttachmentPreview;
		el.detail = notes;
		host.append(el);
		await el.updateComplete;
		const [download, close] = el.shadowRoot!.querySelectorAll('button');
		expect(el.shadowRoot!.activeElement).toBe(download);
		const back = key('Tab', { shiftKey: true });
		download!.dispatchEvent(back);
		expect(back.defaultPrevented).toBe(true);
		expect(el.shadowRoot!.activeElement).toBe(close);
		close!.dispatchEvent(key('Tab'));
		expect(el.shadowRoot!.activeElement).toBe(download);
		const closed: unknown[] = [];
		el.addEventListener('mail-preview-close', (e) => closed.push(e));
		download!.dispatchEvent(key('Escape'));
		expect(closed).toHaveLength(1);
		// The app's shortcuts never see the dialog's keys.
		expect(reached).toEqual([]);
		el.remove();
		await Promise.resolve();
		expect(document.activeElement).toBe(opener);
	});
});
