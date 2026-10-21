import {
	answerReferences,
	composeDraft,
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
		expect(draft.attachments.map((a) => a.blobId)).toEqual(['b1']);
		expect(draft.forwardOfEmailId).toBe('m1');
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
