// A send that creates and submits its message in one request whose answer never comes: the
// message may have gone out, and the same message sent again finds the copy by the Message-ID the
// send gave it (RFC 8621 4.4.1) before anything is sent again.
import type { Draft } from '../model';
import type { FakeServer } from './test-support/fake-server';
import { installMailStore, type MailStore } from './test-support/mail-store';
import { SENT, failure, setup } from './test-support/setup';

const reply: Draft = {
	id: 'old-draft',
	replyToEmailId: 'original',
	to: [{ name: 'John', email: 'john@example.com' }],
	cc: [],
	bcc: [],
	subject: 'World domination',
	text: 'I have the most brilliant plan.',
	attachments: [],
};

function mail() {
	const context = setup();
	return { ...context, store: installMailStore(context.server) };
}

/**
 * Loses the answer to the next request that submits a message: the server does what it asks
 * (`processed`), or the request never reaches it.
 */
function loseAnswer(server: FakeServer, processed: boolean): void {
	let lost = true;
	server.route(
		(request) => lost && (request.body?.includes('EmailSubmission/set') ?? false),
		(request) => {
			lost = false;
			if (processed) server.process(request);
			return Promise.reject(new TypeError('Failed to fetch'));
		},
	);
}

/** The Message-ID the send gave the copy `id`. */
const messageIdOf = (store: MailStore, id: string): unknown =>
	(store.emails.get(id)?.create?.messageId as unknown[] | undefined)?.[0];

describe('a send whose answer never came', () => {
	it('gives the message a Message-ID of its own, at the domain it is sent from', async () => {
		const { transport, store } = mail();
		expect(await transport.send(reply)).toEqual({ id: 'E1' });
		expect(messageIdOf(store, 'E1')).toMatch(/^[0-9a-z]+\.[0-9a-f]{24}@example\.com$/);
		const { id: _saved, ...unsaved } = reply;
		expect(await transport.send(unsaved)).toEqual({ id: 'E2' });
		expect(messageIdOf(store, 'E2')).not.toBe(messageIdOf(store, 'E1'));
	});

	it('may have gone out, and sent again unchanged it does not go out twice', async () => {
		const { server, transport, store } = mail();
		loseAnswer(server, true);
		expect(await failure(transport.send(reply))).toMatchObject({
			code: 'uncertain',
			cause: { code: 'network' },
		});
		expect(store.submissions).toHaveLength(1);
		// Found by its Message-ID and asked about: it went out, so the first send is finished.
		expect(await transport.send(reply)).toEqual({ id: 'E1' });
		expect(server.argsOf('Email/query').at(-1)).toEqual({
			accountId: 'A13824',
			filter: { header: ['Message-ID', messageIdOf(store, 'E1')] },
		});
		expect(server.argsOf('EmailSubmission/query').at(-1)).toEqual({
			accountId: 'A13824',
			filter: { emailIds: ['E1'] },
		});
		expect(store.submissions).toHaveLength(1);
		expect(store.emails.get('E1')).toMatchObject({ mailboxIds: { [SENT]: true } });
		expect(store.emails.has('old-draft')).toBe(false);
		expect(store.emails.get('original')!.keywords).toEqual({ $seen: true, $answered: true });
	});

	it('sends the message once when the copy it made did not go out', async () => {
		const { server, transport, store } = mail();
		store.failSubmission = 'before';
		loseAnswer(server, true);
		expect(await failure(transport.send(reply))).toMatchObject({ code: 'uncertain' });
		store.failSubmission = null;
		expect(store.emails.get('E1')!.keywords).toHaveProperty('$draft');
		// Still a draft and never submitted: the copy is a stray, and the message goes out once.
		expect(await transport.send(reply)).toEqual({ id: 'E2' });
		expect(store.submissions).toEqual([{ identityId: 'XD-3301-222-11_22AAz', emailId: 'E2' }]);
		expect([store.emails.has('E1'), store.emails.has('old-draft')]).toEqual([false, false]);
	});

	it('sends the message once when the request never reached the server', async () => {
		const { server, transport, store } = mail();
		loseAnswer(server, false);
		expect(await failure(transport.send(reply))).toMatchObject({ code: 'uncertain' });
		expect(store.submissions).toEqual([]);
		// The server holds no copy with that Message-ID: nothing went out.
		expect(await transport.send(reply)).toEqual({ id: 'E1' });
		expect(server.argsOf('Email/query')).toHaveLength(1);
		expect(store.submissions).toHaveLength(1);
	});

	it('sends nothing while the server cannot be asked, and asks once it can', async () => {
		const { server, transport, store } = mail();
		loseAnswer(server, true);
		await failure(transport.send(reply));
		let offline = true;
		server.route(
			() => offline,
			() => Promise.reject(new TypeError('Failed to fetch')),
		);
		expect(await failure(transport.send(reply))).toMatchObject({
			code: 'uncertain',
			cause: { code: 'network' },
		});
		offline = false;
		expect(await transport.send(reply)).toEqual({ id: 'E1' });
		expect(store.submissions).toHaveLength(1);
	});

	it('finishes with the copy it filed when the message came back to the account too', async () => {
		const { server, transport, store } = mail();
		loseAnswer(server, true);
		await failure(transport.send(reply));
		// Delivered to an address of the account's own, and listed first by the search.
		const copy = store.emails.get('E1')!;
		store.emails.delete('E1');
		store.emails.set('delivered', {
			mailboxIds: { MBinbox: true },
			keywords: {},
			create: { messageId: copy.create!.messageId },
		});
		store.emails.set('E1', copy);
		expect(await transport.send(reply)).toEqual({ id: 'E1' });
		expect(store.submissions).toHaveLength(1);
		expect(store.emails.get('delivered')!.mailboxIds).toEqual({ MBinbox: true });
	});

	it('fails with its own error when the server refuses the request as a whole', async () => {
		const { server, transport, store } = mail();
		// RFC 8620 3.6: a request rejected as a whole is not processed, so nothing was sent.
		let refusing = true;
		server.route(
			(request) => refusing && (request.body?.includes('EmailSubmission/set') ?? false),
			() => new Response(JSON.stringify({ status: 401 }), { status: 401 }),
		);
		expect(await failure(transport.send(reply))).toMatchObject({
			code: 'unauthorized',
			status: 401,
		});
		// Nothing is left to ask about: sent again, it goes out at once.
		refusing = false;
		expect(await transport.send(reply)).toEqual({ id: 'E1' });
		expect(server.argsOf('Email/query')).toEqual([]);
		expect(store.submissions).toHaveLength(1);
	});

	it('sends the message again when the server cannot search by header field', async () => {
		const { server, transport, store } = mail();
		store.headerSearch = false;
		loseAnswer(server, true);
		expect(await failure(transport.send(reply))).toMatchObject({ code: 'uncertain' });
		// It can never say whether the first copy went out: the message goes out again.
		expect(await transport.send(reply)).toEqual({ id: 'E2' });
		expect(store.submissions).toHaveLength(2);
	});
});
