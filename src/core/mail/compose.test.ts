import {
	answerReferences,
	composeDraft,
	draftFromMessage,
	isEmptyDraft,
	patchDraft,
	replyRecipients,
	type DraftHtml,
	type QuoteFormat,
} from './compose';
import type { DraftAttachment, Identity, MailAttachment, MailMessage } from './model';
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
	it('answers a message the person sent from an address a wildcard identity covers as sent', () => {
		const options = { identity: wildcard, me: [{ name: 'Sales', email: '*@example.net' }], format };
		const mine = message({
			from: [{ name: 'Sales', email: 'Sales@Example.net' }],
			to: [{ name: 'Ben', email: 'ben@example.org' }],
			cc: [{ name: 'Cy', email: 'cy@example.com' }],
		});
		// The person's own message: written from the address it was sent from, to its recipients.
		const reply = composeDraft('reply', mine, { ...options, sent: true });
		expect(reply.from).toEqual({ name: 'Sales', email: 'Sales@Example.net' });
		expect(reply.to.map((a) => a.email)).toEqual(['ben@example.org']);
		const all = composeDraft('replyAll', mine, { ...options, sent: true });
		expect([all.to, all.cc].map((list) => list.map((a) => a.email))).toEqual([
			['ben@example.org'],
			['cy@example.com'],
		]);
		// Written to an address of the domain too, it is answered from that one, as one received.
		const toDesk = message({ from: mine.from, to: [{ name: 'Desk', email: 'desk@example.net' }] });
		const answer = composeDraft('reply', toDesk, { ...options, sent: true });
		expect([answer.from?.email, answer.to.map((a) => a.email)]).toEqual([
			'desk@example.net',
			['Sales@Example.net'],
		]);
	});
	it('never answers a received message as the address of the domain it came from', () => {
		const options = { identity: wildcard, me: [{ name: 'Sales', email: '*@example.net' }], format };
		const alice = { name: 'Alice', email: 'alice@example.net' };
		const received = message({ from: [alice], to: [{ name: 'Team', email: 'list@other.org' }] });
		// A colleague's message to a list: no address of the domain to write from, and answered to them.
		for (const mode of ['reply', 'replyAll'] as const) {
			const draft = composeDraft(mode, received, options);
			expect(draft).not.toHaveProperty('from');
			expect(draft.to.map((a) => a.email)[0]).toBe('alice@example.net');
		}
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
	it('counts the Bcc addresses typed, not those an identity adds of its own', () => {
		const archive = { name: '', email: 'archive@example.com' };
		const ada = { name: 'Ada', email: 'ada@example.com' };
		const own: Identity = { ...identity, bcc: [archive] };
		const draft = composeDraft('new', null, { identity: own, me: [me], format });
		expect(draft.bcc).toEqual([archive]);
		expect(isEmptyDraft(draft, own.bcc)).toBe(true);
		expect(
			isEmptyDraft({ ...draft, bcc: [{ name: 'Archive', email: 'ARCHIVE@example.com' }] }, own.bcc),
		).toBe(true);
		expect(isEmptyDraft({ ...draft, bcc: [archive, ada] }, own.bcc)).toBe(false);
		expect(isEmptyDraft({ ...draft, bcc: [ada] })).toBe(false);
		expect(isEmptyDraft({ ...draft, bcc: [] })).toBe(true);
	});
});

describe('patchDraft', () => {
	const answer = composeDraft('reply', message({ text: 'Lunch?' }), { identity, me: [me], format });

	it('leaves out the HTML a new text alone makes stale, unless the host gave it', () => {
		expect(answer.html).toContain('<blockquote');
		const retexted = patchDraft(answer, { text: `Yes.${answer.text}` }, false);
		expect(retexted).toEqual({ ...answer, text: `Yes.${answer.text}`, html: undefined });
		expect(retexted).not.toHaveProperty('html');
		// The host's HTML, given before or with the text, stays; so does any with the same text.
		expect(patchDraft(answer, { text: 'Yes.' }, true).html).toBe(answer.html);
		expect(patchDraft(answer, { text: 'Yes.', html: '<p>Yes.</p>' }, false).html).toBe(
			'<p>Yes.</p>',
		);
		expect(patchDraft(answer, { subject: 'Lunch', text: answer.text }, false).html).toBe(
			answer.html,
		);
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

describe('the HTML a draft starts with', () => {
	/** A `draftHtml` that answers `result` and records the message and parts it was asked about. */
	function hook(result: string | null) {
		const calls: [string, readonly DraftAttachment[]][] = [];
		const draftHtml: DraftHtml = (source, parts) => {
			calls.push([source.id, parts]);
			return result;
		};
		return { calls, draftHtml };
	}
	const logo: MailAttachment = {
		partId: '2',
		blobId: 'b2',
		name: 'logo.png',
		type: 'image/png',
		size: 3,
		disposition: 'inline',
		cid: 'logo@example.test',
	};
	/** A message whose HTML body came in two parts, the first ending in an open comment. */
	const htmlParts = ['<p>As sent<!--', '<p>More <img src="cid:logo@example.test"></p>'];
	const rich = () => message({ html: htmlParts.join(''), htmlParts, attachments: [logo] });

	it('quotes what draftHtml makes of the original, given the parts the draft carries', () => {
		const { calls, draftHtml } = hook('<p>Cleaned</p>');
		const options = { identity, me: [me], format, draftHtml };
		const forward = composeDraft('forward', rich(), options);
		expect(forward.html).toMatch(/<br><p>Cleaned<\/p>$/);
		for (const mode of ['reply', 'replyAll'] as const)
			expect(composeDraft(mode, rich(), options).html).toMatch(
				/<blockquote type="cite"><p>Cleaned<\/p><\/blockquote>$/,
			);
		// A forward's own parts, so the pictures it shows by cid: stay; an answer carries none.
		expect(forward.attachments).toHaveLength(1);
		expect(calls).toEqual([
			['m1', forward.attachments],
			['m1', []],
			['m1', []],
		]);
	});

	it('quotes the text when draftHtml finds no HTML, and the HTML as sent without draftHtml', () => {
		const options = { identity, me: [me], format };
		const empty = composeDraft('reply', rich(), { ...options, draftHtml: hook(null).draftHtml });
		expect(empty.html).toMatch(/<blockquote type="cite">Line one<br>Line two<\/blockquote>$/);
		expect(composeDraft('forward', rich(), options).html).toMatch(
			/<br><p>As sent<!--<p>More <img src="cid:logo@example.test"><\/p>$/,
		);
	});

	it('reopens a saved draft with what draftHtml makes of it, given its own parts', () => {
		const { calls, draftHtml } = hook('<p>Cleaned</p>');
		const draft = draftFromMessage(rich(), identity, draftHtml);
		expect(draft.html).toBe('<p>Cleaned</p>');
		expect(calls).toEqual([['m1', draft.attachments]]);
		expect(draft.attachments).toEqual([
			{
				blobId: 'b2',
				name: 'logo.png',
				type: 'image/png',
				size: 3,
				cid: 'logo@example.test',
				inline: true,
			},
		]);
		expect(draftFromMessage(rich(), identity, hook(null).draftHtml)).not.toHaveProperty('html');
		expect(draftFromMessage(rich(), identity).html).toBe(htmlParts.join(''));
	});

	it('quotes the text of every part of an HTML body sent in several', () => {
		// Read as one text, the style the first part leaves open would take in the second.
		const parts = ['<p>Notes<style>p{color:red}', '<p>Second part</p>'];
		const original = message({ text: null, html: parts.join(''), htmlParts: parts });
		const options = { identity, me: [me], format };
		expect(composeDraft('reply', original, options).text).toContain('\n> Second part\n');
		expect(composeDraft('forward', original, options).text).toContain('\nSecond part\n');
		expect(draftFromMessage(original, identity).text).toContain('\nSecond part\n');
	});
});
