import submission from './__fixtures__/rfc8621-submission.json';
import { createMailClient } from '../client';
import type { Draft } from '../model';
import { createFakeServer, rfcSession, until } from './test-support/fake-server';
import { installMailStore } from './test-support/mail-store';
import { DRAFTS, MAILBOXES, SENT, failure, setup } from './test-support/setup';

const draft: Draft = {
	to: [{ name: 'John', email: 'john@example.com' }],
	cc: [{ name: '', email: 'cc@example.com' }],
	bcc: [],
	subject: 'World domination',
	text: 'I have the most brilliant plan.',
	html: '<p>I have the most <b>brilliant</b> plan.</p>',
	attachments: [{ blobId: 'G1', name: 'plan.pdf', type: 'application/pdf', size: 3 }],
	inReplyTo: ['parent@example.com'],
	references: ['root@example.com', 'parent@example.com'],
};

function mail() {
	const context = setup();
	return { ...context, store: installMailStore(context.server) };
}

/** The mail store on a server that takes at most `max` calls in one request. */
function limited(max: number) {
	const context = mail();
	context.server.limitCalls(max);
	return context;
}

const callNames = (requests: { methodCalls: [string, unknown, string][] }[]) =>
	requests.map((request) => request.methodCalls.map(([name]) => name));

describe('saveDraft', () => {
	it('creates the draft in Drafts with $draft and $seen, one text and one HTML part', async () => {
		const { server, transport } = mail();
		expect(await transport.saveDraft(draft)).toEqual({ id: 'E1' });
		expect(server.argsOf('Email/set')).toEqual([
			{
				accountId: 'A13824',
				create: {
					draft: {
						mailboxIds: { [DRAFTS]: true },
						keywords: { $draft: true, $seen: true },
						from: [{ name: 'Joe Bloggs', email: 'joe@example.com' }],
						to: [{ name: 'John', email: 'john@example.com' }],
						cc: [{ name: null, email: 'cc@example.com' }],
						subject: 'World domination',
						inReplyTo: ['parent@example.com'],
						references: ['root@example.com', 'parent@example.com'],
						bodyValues: {
							text: { value: 'I have the most brilliant plan.' },
							html: { value: '<p>I have the most <b>brilliant</b> plan.</p>' },
						},
						textBody: [{ partId: 'text', type: 'text/plain' }],
						htmlBody: [{ partId: 'html', type: 'text/html' }],
						attachments: [
							{
								blobId: 'G1',
								type: 'application/pdf',
								name: 'plan.pdf',
								disposition: 'attachment',
							},
						],
					},
				},
			},
		]);
	});

	it('destroys the previous draft in the same request, only once the new one exists', async () => {
		const { server, transport, store } = mail();
		expect(await transport.saveDraft({ ...draft, id: 'old-draft' })).toEqual({ id: 'E1' });
		expect(store.emails.has('old-draft')).toBe(false);
		const requests = server.apiRequests();
		expect(callNames(requests).slice(-2)).toEqual([
			['Core/echo', 'Core/echo'],
			['Email/set', 'Core/echo', 'Email/set'],
		]);
		expect(requests.at(-1)!.methodCalls.slice(1)).toEqual([
			[
				'Core/echo',
				{
					'#saved': { resultOf: '0', name: 'Email/set', path: '/created/draft/id' },
					destroy: ['old-draft'],
				},
				'1',
			],
			[
				'Email/set',
				{ accountId: 'A13824', '#destroy': { resultOf: '1', name: 'Core/echo', path: '/destroy' } },
				'2',
			],
		]);
		await transport.saveDraft({ ...draft, id: 'E1' });
		expect(
			callNames(server.apiRequests()).filter((names) => names[0] === 'Core/echo'),
		).toHaveLength(1);
	});

	it('keeps the previous draft when the new one is refused', async () => {
		const { transport, store } = mail();
		store.refuseCreate = 'overQuota';
		expect(await failure(transport.saveDraft({ ...draft, id: 'old-draft' }))).toMatchObject({
			code: 'overQuota',
			type: 'overQuota',
		});
		expect(store.emails.has('old-draft')).toBe(true);
	});

	it('destroys the previous draft in a second request when the server does not resolve echoes', async () => {
		const { server, transport, store } = mail();
		server.on('Core/echo', () => ({}));
		await transport.saveDraft({ ...draft, id: 'old-draft' });
		expect(callNames(server.apiRequests()).slice(-2)).toEqual([['Email/set'], ['Email/set']]);
		expect(server.argsOf('Email/set').at(-1)).toEqual({
			accountId: 'A13824',
			destroy: ['old-draft'],
		});
		expect(store.emails.has('old-draft')).toBe(false);
	});

	it('saves an edited draft whole when a message fetch would cut it short', async () => {
		const { server, transport, store } = mail();
		const whole = `${'The plan, step by step. '.repeat(4)}The end.`;
		server.on('Email/query', () => ({ ids: [], position: 0, total: 0 }));
		server.on('Email/get', (args) => ({
			state: 'E1',
			list: [
				{
					id: 'old-draft',
					mailboxIds: { [DRAFTS]: true },
					keywords: { $draft: true, $seen: true },
					to: [{ name: 'John', email: 'john@example.com' }],
					subject: 'World domination',
					textBody: [{ partId: '1', type: 'text/plain' }],
					htmlBody: [{ partId: '1', type: 'text/plain' }],
					bodyValues: {
						'1': args.maxBodyValueBytes
							? { value: whole.slice(0, 24), isTruncated: true }
							: { value: whole, isTruncated: false },
					},
				},
			],
		}));
		const client = createMailClient({ transport });
		await until(() => client.getState().status === 'ready');
		await client.editDraft('old-draft');
		client.updateDraft({ subject: 'World domination, the sequel' });
		await client.saveDraft();
		client.destroy();
		expect(store.emails.has('old-draft')).toBe(false);
		expect(store.emails.get('E1')!.create).toMatchObject({
			subject: 'World domination, the sequel',
			bodyValues: { text: { value: whole } },
		});
	});

	it('needs a Drafts mailbox', async () => {
		const { server, transport } = mail();
		server.on('Mailbox/get', () => ({
			state: 'M1',
			list: MAILBOXES.filter((m) => m.role !== 'drafts'),
		}));
		expect(await failure(transport.saveDraft(draft))).toMatchObject({ code: 'notFound' });
	});
});

describe('send', () => {
	const reply: Draft = { ...draft, id: 'old-draft', replyToEmailId: 'original' };

	it('creates, submits, files in Sent, drops the draft and marks the original in one request', async () => {
		const { server, transport, store } = mail();
		expect(await transport.send(reply)).toEqual({ id: 'E1' });
		const last = server.apiRequests().at(-1)!;
		expect(last.methodCalls.map(([name]) => name)).toEqual([
			'Email/set',
			'EmailSubmission/set',
			'Core/echo',
			'Email/set',
		]);
		const [, submit, echo, clean] = last.methodCalls;
		expect(submit![1]).toEqual({
			accountId: 'A13824',
			create: { send: { identityId: 'XD-3301-222-11_22AAz', emailId: '#draft' } },
			onSuccessUpdateEmail: {
				'#send': (
					submission.submissionRequest[1] as { onSuccessUpdateEmail: Record<string, unknown> }
				).onSuccessUpdateEmail['#k1490'],
			},
		});
		expect(echo![1]).toEqual({
			'#sent': { resultOf: '1', name: 'EmailSubmission/set', path: '/created/send/id' },
			destroy: ['old-draft'],
			update: { original: { 'keywords/$answered': true } },
		});
		expect(clean![1]).toEqual({
			accountId: 'A13824',
			'#destroy': { resultOf: '2', name: 'Core/echo', path: '/destroy' },
			'#update': { resultOf: '2', name: 'Core/echo', path: '/update' },
		});
		expect(store.emails.get('E1')).toMatchObject({
			mailboxIds: { [SENT]: true },
			keywords: { $seen: true },
		});
		expect(store.emails.get('E1')!.keywords).not.toHaveProperty('$draft');
		expect(store.emails.has('old-draft')).toBe(false);
		expect(store.emails.get('original')!.keywords).toEqual({ $seen: true, $answered: true });
		expect(store.submissions).toEqual([{ identityId: 'XD-3301-222-11_22AAz', emailId: 'E1' }]);
	});

	it('marks a forward $forwarded and writes as the identity the draft names', async () => {
		const { transport, store } = mail();
		await transport.send({
			...draft,
			identityId: 'XD-9911312-11_22AAz',
			from: { name: 'Joe', email: 'joe@example.com' },
			forwardOfEmailId: 'original',
		});
		expect(store.submissions[0]).toMatchObject({ identityId: 'XD-9911312-11_22AAz' });
		expect(store.emails.get('original')!.keywords).toEqual({ $seen: true, $forwarded: true });
	});

	it('surfaces a refused submission and leaves the saved draft as it was', async () => {
		const { server, transport, store } = mail();
		store.refuseSubmission = 'forbiddenFrom';
		expect(await failure(transport.send(reply))).toMatchObject({
			code: 'forbidden',
			type: 'forbiddenFrom',
		});
		expect(store.emails.has('old-draft')).toBe(true);
		expect(store.emails.has('E1')).toBe(false);
		expect(store.emails.get('original')!.keywords).toEqual({ $seen: true });
		expect(server.argsOf('Email/set').at(-1)).toEqual({ accountId: 'A13824', destroy: ['E1'] });
	});

	it('keeps the copy it made when the server may have sent it before failing', async () => {
		const { server, transport, store } = mail();
		// RFC 8620 3.6.2: some of what the call asked for happened, the submission perhaps. That is
		// what the error says, not that the send failed; the server's own answer is its cause.
		server.on('EmailSubmission/set', (_args, call) => [
			['error', { type: 'serverPartialFail' }, call.id],
		]);
		expect(await failure(transport.send(reply))).toMatchObject({
			code: 'uncertain',
			cause: { type: 'serverPartialFail' },
		});
		// No answer for the submission at all says no more.
		const silent = mail();
		silent.server.on('EmailSubmission/set', () => []);
		expect(await failure(silent.transport.send(reply))).toMatchObject({
			code: 'uncertain',
			cause: { code: 'server' },
		});
		for (const { server: each, store: kept } of [{ server, store }, silent]) {
			expect(kept.emails.has('E1')).toBe(true);
			expect(kept.emails.has('old-draft')).toBe(true);
			expect(each.argsOf('Email/set').filter((args) => 'destroy' in args)).toEqual([]);
		}
	});

	it('never sends a message twice when Send is pressed again after an uncertain send', async () => {
		const { server, transport, store } = mail();
		// The server sent it, then failed: whether it went out cannot be told from the answer.
		store.failSubmission = 'after';
		expect(await failure(transport.send(reply))).toMatchObject({ code: 'uncertain' });
		store.failSubmission = null;
		// The same message again: the server is asked first, and the first send is finished instead.
		expect(await transport.send(reply)).toEqual({ id: 'E1' });
		expect(server.argsOf('EmailSubmission/query').at(-1)).toEqual({
			accountId: 'A13824',
			filter: { emailIds: ['E1'] },
		});
		expect(store.submissions).toEqual([{ identityId: 'XD-3301-222-11_22AAz', emailId: 'E1' }]);
		expect(store.emails.get('E1')).toMatchObject({ mailboxIds: { [SENT]: true } });
		expect(store.emails.get('E1')!.keywords).not.toHaveProperty('$draft');
		expect(store.emails.has('old-draft')).toBe(false);
		expect(store.emails.get('original')!.keywords).toEqual({ $seen: true, $answered: true });
	});

	it('sends the message again when the server says the uncertain send did not go out', async () => {
		const { transport, store } = mail();
		store.failSubmission = 'before';
		expect(await failure(transport.send(reply))).toMatchObject({ code: 'uncertain' });
		store.failSubmission = null;
		// No submission and still a draft: the copy is a stray, and the message goes out once.
		expect(await transport.send(reply)).toEqual({ id: 'E2' });
		expect(store.submissions).toEqual([{ identityId: 'XD-3301-222-11_22AAz', emailId: 'E2' }]);
		expect([store.emails.has('E1'), store.emails.has('old-draft')]).toEqual([false, false]);
		// When the server cannot say (the copy is gone), it is sent again as before.
		const gone = mail();
		gone.store.failSubmission = 'before';
		await failure(gone.transport.send(reply));
		gone.store.failSubmission = null;
		gone.store.emails.delete('E1');
		expect(await gone.transport.send(reply)).toEqual({ id: 'E2' });
		expect(gone.store.submissions).toHaveLength(1);
	});

	it('drops the copy when the submission failed as a whole, which changes nothing', async () => {
		const { server, transport, store } = mail();
		server.on('EmailSubmission/set', (_args, call) => [['error', { type: 'forbidden' }, call.id]]);
		expect(await failure(transport.send(reply))).toMatchObject({ type: 'forbidden' });
		expect(store.emails.has('E1')).toBe(false);
		expect(store.emails.has('old-draft')).toBe(true);
	});

	it.each([
		['invalidEmail', 'invalid'],
		['noRecipients', 'invalid'],
		['invalidRecipients', 'invalid'],
		['tooManyRecipients', 'invalid'],
		['forbiddenMailFrom', 'forbidden'],
		['forbiddenToSend', 'forbidden'],
		['tooLarge', 'tooLarge'],
	])('maps a %s submission error to %s', async (type, code) => {
		const { transport, store } = mail();
		store.refuseSubmission = type;
		expect(await failure(transport.send(draft))).toMatchObject({ code, type, level: 'set' });
	});

	it('sends nothing and keeps everything when the message cannot be created', async () => {
		const { transport, store } = mail();
		store.refuseCreate = 'blobNotFound';
		expect(await failure(transport.send(reply))).toMatchObject({
			code: 'notFound',
			type: 'blobNotFound',
		});
		expect(store.submissions).toEqual([]);
		expect(store.emails.has('old-draft')).toBe(true);
		expect(store.emails.get('original')!.keywords).toEqual({ $seen: true });
	});

	it('cleans up in a second request when the server does not resolve echoes', async () => {
		const { server, transport, store } = mail();
		server.on('Core/echo', (_args, call) => [['error', { type: 'unknownMethod' }, call.id]]);
		await transport.send(reply);
		expect(callNames(server.apiRequests()).slice(-2)).toEqual([
			['Email/set', 'EmailSubmission/set'],
			['Email/set'],
		]);
		expect(server.argsOf('Email/set').at(-1)).toEqual({
			accountId: 'A13824',
			destroy: ['old-draft'],
			update: { original: { 'keywords/$answered': true } },
		});
		expect(store.emails.has('old-draft')).toBe(false);
	});

	it('files the message itself when the server skipped onSuccessUpdateEmail', async () => {
		const { server, transport, store } = mail();
		store.skipImplicit = true;
		await transport.send(draft);
		expect(server.argsOf('Email/set').at(-1)).toEqual({
			accountId: 'A13824',
			update: {
				E1: {
					[`mailboxIds/${DRAFTS}`]: null,
					[`mailboxIds/${SENT}`]: true,
					'keywords/$draft': null,
				},
			},
		});
		expect(store.emails.get('E1')!.mailboxIds).toEqual({ [SENT]: true });
	});

	it('keeps a sent message in Drafts, no longer a draft, when there is no Sent mailbox', async () => {
		const { server, transport } = mail();
		server.on('Mailbox/get', () => ({
			state: 'M1',
			list: MAILBOXES.filter((m) => m.role !== 'sent'),
		}));
		await transport.send(draft);
		expect(server.argsOf('EmailSubmission/set')[0]!.onSuccessUpdateEmail).toEqual({
			'#send': { 'keywords/$draft': null },
		});
	});

	it('keeps the copy when the request that submits it fails as a whole', async () => {
		const { server, transport, store } = limited(1);
		server.route(
			(request) => request.body?.includes('EmailSubmission/set') ?? false,
			() => Promise.reject(new TypeError('Failed to fetch')),
		);
		expect(await failure(transport.send(reply))).toMatchObject({
			code: 'uncertain',
			cause: { code: 'network' },
		});
		// Whether it went out is not known: the copy stays, and nothing else is changed.
		expect(store.emails.has('E1')).toBe(true);
		expect(store.emails.has('old-draft')).toBe(true);
	});

	it('refuses to send without submission or without an identity', async () => {
		const plain = setup({
			server: createFakeServer({ session: rfcSession({ submission: false }) }),
		});
		installMailStore(plain.server);
		expect(await failure(plain.transport.send(draft))).toMatchObject({ code: 'unsupported' });
		const nobody = mail();
		nobody.server.on('Identity/get', () => ({ state: 'I1', list: [] }));
		expect(await failure(nobody.transport.send(draft))).toMatchObject({ code: 'forbidden' });
	});
});

describe('the calls the server takes in one request', () => {
	const reply: Draft = { ...draft, id: 'old-draft', replyToEmailId: 'original' };
	const sizes = (requests: { methodCalls: unknown[] }[]) =>
		requests.map((request) => request.methodCalls.length);

	it('saves within two, the previous draft destroyed in a request of its own', async () => {
		const { server, transport, store } = limited(2);
		expect(await transport.saveDraft({ ...draft, id: 'old-draft' })).toEqual({ id: 'E1' });
		expect(store.emails.has('old-draft')).toBe(false);
		expect(callNames(server.apiRequests()).slice(-2)).toEqual([['Email/set'], ['Email/set']]);
		expect(Math.max(...sizes(server.apiRequests()))).toBeLessThanOrEqual(2);
	});

	it('sends a reply within three, the clean-up in a request of its own', async () => {
		const { server, transport, store } = limited(3);
		expect(await transport.send(reply)).toEqual({ id: 'E1' });
		expect(callNames(server.apiRequests()).slice(-2)).toEqual([
			['Email/set', 'EmailSubmission/set'],
			['Email/set'],
		]);
		expect(Math.max(...sizes(server.apiRequests()))).toBeLessThanOrEqual(3);
		expect(store.emails.get('E1')).toMatchObject({ mailboxIds: { [SENT]: true } });
		expect(store.emails.has('old-draft')).toBe(false);
		expect(store.emails.get('original')!.keywords).toEqual({ $seen: true, $answered: true });
	});

	it('saves and sends one call at a time when the server takes one', async () => {
		const { server, transport, store } = limited(1);
		expect(await transport.saveDraft({ ...draft, id: 'old-draft' })).toEqual({ id: 'E1' });
		expect(await transport.send({ ...reply, id: 'E1' })).toEqual({ id: 'E2' });
		expect(callNames(server.apiRequests()).slice(-3)).toEqual([
			['Email/set'],
			['EmailSubmission/set'],
			['Email/set'],
		]);
		expect(Math.max(...sizes(server.apiRequests()))).toBe(1);
		expect(store.submissions).toEqual([{ identityId: 'XD-3301-222-11_22AAz', emailId: 'E2' }]);
		expect(store.emails.get('E2')).toMatchObject({ mailboxIds: { [SENT]: true } });
		expect([store.emails.has('old-draft'), store.emails.has('E1')]).toEqual([false, false]);
		expect(store.emails.get('original')!.keywords).toEqual({ $seen: true, $answered: true });
	});
});
