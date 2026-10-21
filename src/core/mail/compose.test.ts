import {
	answerReferences,
	composeDraft,
	draftFromMessage,
	isEmptyDraft,
	replyRecipients,
	type QuoteFormat,
} from './compose';
import type { Identity, MailMessage } from './model';
import { summary } from './test-support/emails';

const me = { name: 'Sam', email: 'sam@example.com' };
const identity: Identity = {
	id: 'i1',
	...me,
	replyTo: [],
	bcc: [],
	textSignature: '',
	htmlSignature: '',
};
/** May write as any address of its domain (RFC 8621 6). */
const wildcard: Identity = { ...identity, id: 'i2', name: 'Sales', email: '*@example.net' };
const format: QuoteFormat = {
	attribution: (m) => `On day, ${m.from[0]!.email} wrote:`,
	forwardHeader: (m) => ['-- Forwarded --', `Subject: ${m.subject}`],
};

function message(overrides: Partial<MailMessage> = {}): MailMessage {
	return {
		...summary('m1', {
			subject: 'Plan',
			from: { name: 'Ada', email: 'ada@example.com' },
			to: [me, { name: 'Ben', email: 'ben@example.com' }],
			references: ['root@example.com'],
		}),
		cc: [
			{ name: 'Cy', email: 'cy@example.com' },
			{ name: 'Sam again', email: 'SAM@example.com' },
		],
		text: 'Line one\nLine two',
		html: null,
		attachments: [],
		...overrides,
	};
}

describe('reply recipients', () => {
	it('reply goes to Reply-To, else the sender', () => {
		expect(replyRecipients(message(), 'reply', [me]).to.map((a) => a.email)).toEqual([
			'ada@example.com',
		]);
		const withReplyTo = message({ replyTo: [{ name: 'List', email: 'list@example.com' }] });
		expect(replyRecipients(withReplyTo, 'reply', [me]).to.map((a) => a.email)).toEqual([
			'list@example.com',
		]);
	});
	it('reply all adds the others and never yourself', () => {
		const { to, cc } = replyRecipients(message(), 'replyAll', [me]);
		expect(to.map((a) => a.email)).toEqual(['ada@example.com', 'ben@example.com']);
		expect(cc.map((a) => a.email)).toEqual(['cy@example.com']);
	});
	it('answering your own message goes to its recipients', () => {
		const mine = message({ from: [me], to: [{ name: 'Ben', email: 'ben@example.com' }] });
		expect(replyRecipients(mine, 'reply', [me]).to.map((a) => a.email)).toEqual([
			'ben@example.com',
		]);
	});
});

describe('composeDraft', () => {
	it('threads a reply with In-Reply-To and References and quotes the text', () => {
		const draft = composeDraft('reply', message(), { identity, me: [me], format });
		expect(draft.subject).toBe('Re: Plan');
		expect(draft.inReplyTo).toEqual(['m1@example.test']);
		expect(answerReferences(message())).toEqual(['root@example.com', 'm1@example.test']);
		expect(draft.references).toEqual(['root@example.com', 'm1@example.test']);
		expect(draft.text).toContain('On day, ada@example.com wrote:\n> Line one\n> Line two');
		expect(draft.html).toContain('<blockquote type="cite">Line one<br>Line two</blockquote>');
		expect(draft.replyToEmailId).toBe('m1');
		expect(draft.from).toEqual(me);
	});
	it('forwards with the header block and the original attachments', () => {
		const original = message({
			attachments: [
				{
					partId: '2',
					blobId: 'b1',
					name: 'a.pdf',
					type: 'application/pdf',
					size: 3,
					disposition: 'attachment',
					cid: null,
				},
				{
					partId: '3',
					blobId: 'b2',
					name: 'logo.png',
					type: 'image/png',
					size: 3,
					disposition: 'inline',
					cid: 'logo',
				},
			],
		});
		const draft = composeDraft('forward', original, { identity, me: [me], format });
		expect(draft.subject).toBe('Fwd: Plan');
		expect(draft.to).toEqual([]);
		expect(draft.text).toContain('-- Forwarded --\nSubject: Plan');
		// Every part, the inline one as inline: a text message's inline part is listed as a file.
		expect(draft.attachments).toEqual([
			{ blobId: 'b1', name: 'a.pdf', type: 'application/pdf', size: 3 },
			{ blobId: 'b2', name: 'logo.png', type: 'image/png', size: 3, cid: 'logo', inline: true },
		]);
		expect(draft.forwardOfEmailId).toBe('m1');
	});
	it('forwards the images its copied HTML shows with their Content-ID, so they still show', () => {
		const original = message({
			html: '<p>Our logo: <img src="cid:Logo@example.test"></p>',
			attachments: [
				{
					partId: '2',
					blobId: 'b2',
					name: 'logo.png',
					type: 'image/png',
					size: 3,
					disposition: 'inline',
					cid: 'Logo@example.test',
				},
				// A part of a related with no disposition, as many senders write them: still inline.
				{
					partId: '3',
					blobId: 'b3',
					name: 'line.png',
					type: 'image/png',
					size: 3,
					disposition: null,
					cid: 'line@example.test',
				},
			],
		});
		const draft = composeDraft('forward', original, { identity, me: [me], format });
		expect(draft.html).toContain('<img src="cid:Logo@example.test">');
		expect(draft.attachments).toEqual([
			{
				blobId: 'b2',
				name: 'logo.png',
				type: 'image/png',
				size: 3,
				cid: 'Logo@example.test',
				inline: true,
			},
			{
				blobId: 'b3',
				name: 'line.png',
				type: 'image/png',
				size: 3,
				cid: 'line@example.test',
				inline: true,
			},
		]);
	});
	it('answers from the address a wildcard identity was written to, never as the wildcard', () => {
		const original = message({
			to: [
				{ name: 'Sales desk', email: 'Desk@Example.net' },
				{ name: 'Ben', email: 'ben@example.org' },
			],
			cc: [],
		});
		const options = { identity: wildcard, me: [{ name: 'Sales', email: '*@example.net' }], format };
		const draft = composeDraft('replyAll', original, options);
		expect(draft.identityId).toBe('i2');
		expect(draft.from).toEqual({ name: 'Sales', email: 'Desk@Example.net' });
		// The address the answer is written from is not copied in to it.
		expect(draft.to.map((a) => a.email)).toEqual(['ada@example.com', 'ben@example.org']);
		// Nothing to answer, or no address of the domain written to: no From, as the transport expects.
		expect(composeDraft('new', null, options)).not.toHaveProperty('from');
		const elsewhere = message({ to: [{ name: 'Ben', email: 'ben@example.org' }], cc: [] });
		expect(composeDraft('reply', elsewhere, options)).not.toHaveProperty('from');
	});
	it('escapes quoted text that looks like markup', () => {
		const draft = composeDraft('reply', message({ text: '<script>x</script>' }), {
			identity,
			me: [me],
			format,
		});
		expect(draft.html).not.toContain('<script>');
	});
	it('knows an empty draft', () => {
		const draft = composeDraft('new', null, { identity, me: [me], format });
		expect(isEmptyDraft(draft)).toBe(true);
		expect(isEmptyDraft({ ...draft, subject: 'x' })).toBe(false);
	});
	it('counts formatted text and pictures as content, not an empty editor', () => {
		const draft = composeDraft('new', null, { identity, me: [me], format });
		expect(isEmptyDraft({ ...draft, html: '<p>Notes</p>' })).toBe(false);
		expect(isEmptyDraft({ ...draft, html: '<p><img src="data:image/png;base64,AAAA"></p>' })).toBe(
			false,
		);
		for (const html of ['<p><br></p>', '<div>&nbsp; </div>', ' <br> ', '<p></p><p>&#160;</p>'])
			expect(isEmptyDraft({ ...draft, html })).toBe(true);
	});
});

describe('draftFromMessage', () => {
	it('reopens a saved draft with its inline images still inline', () => {
		const saved = message({
			html: '<p><img src="cid:logo@example.test"></p>',
			attachments: [
				{
					partId: '2',
					blobId: 'b2',
					name: 'logo.png',
					type: 'image/png',
					size: 3,
					disposition: 'inline',
					cid: 'logo@example.test',
				},
			],
		});
		expect(draftFromMessage(saved, identity).attachments).toEqual([
			{
				blobId: 'b2',
				name: 'logo.png',
				type: 'image/png',
				size: 3,
				cid: 'logo@example.test',
				inline: true,
			},
		]);
	});
	it('gives a draft saved with only HTML a plain text made from that HTML', () => {
		const html = '<div>Dear Ada,</div><div>the plan &amp; the budget.</div>';
		const draft = draftFromMessage(message({ text: null, html }), identity);
		expect(draft.text.split('\n').filter(Boolean)).toEqual(['Dear Ada,', 'the plan & the budget.']);
		expect(draft.html).toBe(html);
		expect(draftFromMessage(message({ text: 'Own text', html }), identity).text).toBe('Own text');
		expect(draftFromMessage(message({ text: null, html: null }), identity).text).toBe('');
	});
});
