import { messageFromDraft, messageFromSeed } from './memory-messages';

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);
const ada = { name: 'Ada', email: 'ada@example.com' };
const photo = {
	name: 'photo.png',
	type: 'image/png',
	bytes: Uint8Array.of(0x89, 0x50, 0x4e, 0x47),
	cid: 'photo@example.com',
	inline: true,
};

describe('the attachment flag of a stored message', () => {
	it('counts an inline image as a file unless its HTML shows it as a picture', () => {
		const seeded = (html: string) =>
			messageFromSeed(
				{
					mailboxId: 'inbox',
					from: ada,
					subject: 'Photo',
					html,
					attachments: [photo],
					receivedAt: T0,
				},
				'm1',
				new Map(),
			).hasAttachment;
		// Only linked to, or named in the text: the reading pane lists it as a file.
		expect(seeded('<a href="cid:photo@example.com">Download</a>')).toBe(true);
		expect(seeded('<p>Saved as cid:photo@example.com</p>')).toBe(true);
		expect(seeded('<p><img src="cid:photo@example.com"></p>')).toBe(false);
		// A part that is not an image is a file, wherever the HTML names it.
		const pdf = { ...photo, name: 'plan.pdf', type: 'application/pdf' };
		expect(
			messageFromSeed(
				{
					mailboxId: 'inbox',
					from: ada,
					subject: 'Plan',
					html: '<img src="cid:photo@example.com">',
					attachments: [pdf],
					receivedAt: T0,
				},
				'm2',
				new Map(),
			).hasAttachment,
		).toBe(true);
	});

	it('reads a draft or a sent copy by the same rule', () => {
		const stored = (html: string) =>
			messageFromDraft(
				{
					to: [ada],
					cc: [],
					bcc: [],
					subject: 'Photo',
					text: 'photo',
					html,
					attachments: [
						{
							blobId: 'b1',
							name: 'photo.png',
							type: 'image/png',
							size: 4,
							cid: photo.cid,
							inline: true,
						},
					],
				},
				's1',
				{ mailboxId: 'sent', sent: true, now: T0, from: ada, blobs: new Map() },
			).hasAttachment;
		expect(stored('<a href="cid:photo@example.com">Download</a>')).toBe(true);
		expect(stored('<img src="cid:photo@example.com">')).toBe(false);
	});
});
