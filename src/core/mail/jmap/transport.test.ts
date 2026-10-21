import email from './__fixtures__/rfc8621-email.json';
import mailbox from './__fixtures__/rfc8621-mailbox.json';
import { parseSearch } from '../search';
import { SUMMARY_PROPERTIES } from './emails';
import { createFakeServer, rfcSession } from './test-support/fake-server';
import { DRAFTS, failure, MAILBOXES, setup } from './test-support/setup';
import type { JmapInvocation } from './types';

const responseArgs = (invocation: unknown): Record<string, unknown> =>
	(invocation as JmapInvocation)[1];

describe('connect', () => {
	it('loads the session and the identities when the account can send', async () => {
		const { server, transport } = setup();
		const session = await transport.connect();
		expect(transport.kind).toBe('jmap');
		expect(session.account).toEqual({ id: 'A13824', name: 'john@example.com' });
		expect(session.canSend).toBe(true);
		expect(session.identities.map((identity) => identity.id)).toEqual([
			'XD-3301-222-11_22AAz',
			'XD-9911312-11_22AAz',
		]);
		expect(server.apiRequests()).toEqual([
			{
				using: [
					'urn:ietf:params:jmap:core',
					'urn:ietf:params:jmap:mail',
					'urn:ietf:params:jmap:submission',
				],
				methodCalls: [['Identity/get', { accountId: 'A13824' }, '0']],
			},
		]);
	});

	it('cannot send without submission, from a read-only account or when identities are refused', async () => {
		const plain = setup({
			server: createFakeServer({ session: rfcSession({ submission: false }) }),
		});
		expect(await plain.transport.connect()).toMatchObject({ canSend: false, identities: [] });
		expect(plain.server.calls()).toEqual([]);
		const readOnly = setup({ accountId: 'A97813' });
		expect(await readOnly.transport.connect()).toMatchObject({
			account: { id: 'A97813', name: 'jane@example.com' },
			canSend: false,
		});
		const refused = setup();
		refused.server.on('Identity/get', (_args, call) => [['error', { type: 'forbidden' }, call.id]]);
		expect(await refused.transport.connect()).toMatchObject({ canSend: false, identities: [] });
	});

	it('refetches the session when a response carries another sessionState', async () => {
		const { server, transport } = setup();
		await transport.connect();
		server.sessionState = 'changed';
		await transport.mailboxes();
		await transport.mailboxes();
		const sessionReads = server.requests.filter((request) => request.method === 'GET').length;
		expect(sessionReads).toBe(2);
	});

	it('tries a failed session refetch again, a few times at most', async () => {
		const { server, transport } = setup();
		await transport.connect();
		server.sessionState = 'changed';
		const reads = () => server.requests.filter((request) => request.method === 'GET').length;
		let failures = 1;
		server.route(
			(request) => request.method === 'GET' && failures > 0,
			() => {
				failures--;
				return new Response('down', { status: 503 });
			},
		);
		// The refetch the first response asks for fails; the next response asks again, and it works.
		await transport.mailboxes();
		await transport.mailboxes();
		await transport.mailboxes();
		expect(reads()).toBe(3);
		// Done for that state: the session it read still names another one, and that is no reason
		// to ask again on every response.
		await transport.mailboxes();
		expect(reads()).toBe(3);

		// A session resource that keeps failing is asked three times for one state, then left.
		const down = setup();
		await down.transport.connect();
		down.server.sessionState = 'changed';
		down.server.route(
			(request) => request.method === 'GET',
			() => new Response('down', { status: 503 }),
		);
		for (let call = 0; call < 6; call++) await down.transport.mailboxes();
		expect(down.server.requests.filter((request) => request.method === 'GET')).toHaveLength(4);
	});

	it('lets the caller cancel, and connects again afterwards', async () => {
		const { server, transport } = setup();
		let hang = true;
		server.route(
			() => hang,
			() => new Promise<Response>(() => {}),
		);
		const controller = new AbortController();
		const pending = transport.connect(controller.signal);
		await new Promise((resolve) => setImmediate(resolve));
		controller.abort();
		expect(await failure(pending)).toMatchObject({ name: 'AbortError' });
		hang = false;
		expect((await transport.connect()).account.id).toBe('A13824');
	});
});

describe('mailboxes', () => {
	it('reads every mailbox with Mailbox/get, as RFC 8621 2.6 does', async () => {
		const { server, transport } = setup();
		server.on('Mailbox/get', () => responseArgs(mailbox.getResponse));
		const list = await transport.mailboxes();
		expect(server.argsOf('Mailbox/get')).toEqual([
			{
				accountId: 'A13824',
				ids: null,
				properties: ['name', 'parentId', 'role', 'sortOrder', 'totalEmails', 'unreadEmails'],
			},
		]);
		expect(list.map((item) => [item.id, item.name, item.role, item.unreadEmails])).toEqual([
			['MB23cfa8094c0f41e6', 'Inbox', 'inbox', 13905],
			['MB674cc24095db49ce', 'Important mail', null, 2],
		]);
	});

	it('lists the ids and fetches them in batches when there are too many for one /get', async () => {
		const { server, transport } = setup();
		server.session = rfcSession();
		const core = (server.session.capabilities as Record<string, Record<string, unknown>>)[
			'urn:ietf:params:jmap:core'
		]!;
		core.maxObjectsInGet = 2;
		server.on('Mailbox/get', (args, call) =>
			args.ids === null
				? [['error', { type: 'requestTooLarge' }, call.id]]
				: {
						state: 'M1',
						list: MAILBOXES.filter((item) => (args.ids as string[]).includes(item.id)),
					},
		);
		server.on('Mailbox/query', () => ({ ids: MAILBOXES.map((item) => item.id), total: 5 }));
		const list = await transport.mailboxes();
		expect(list.map((item) => item.id)).toEqual(MAILBOXES.map((item) => item.id));
		expect(server.argsOf('Mailbox/get').map((args) => args.ids)).toEqual([
			null,
			['MBinbox', DRAFTS],
			[MAILBOXES[2]!.id, 'MBall'],
			['MBwork'],
		]);
	});

	/** A server that needs the query fallback and answers each `Mailbox/query` with `page`. */
	const paged = (page: (position: number) => Record<string, unknown>) => {
		const context = setup();
		const { server } = context;
		server.session = rfcSession();
		const core = (server.session.capabilities as Record<string, Record<string, unknown>>)[
			'urn:ietf:params:jmap:core'
		]!;
		core.maxObjectsInGet = 2;
		server.on('Mailbox/get', (args, call) =>
			args.ids === null
				? [['error', { type: 'requestTooLarge' }, call.id]]
				: {
						state: 'M1',
						list: MAILBOXES.filter((item) => (args.ids as string[]).includes(item.id)),
					},
		);
		server.on('Mailbox/query', (args) =>
			page(typeof args.position === 'number' ? args.position : 0),
		);
		return context;
	};

	it('pages through Mailbox/query when the server returns fewer ids than there are', async () => {
		// The server keeps every page to two ids, whatever the request asks (RFC 8620 5.5).
		const { server, transport } = paged((position) => ({
			ids: MAILBOXES.slice(position, position + 2).map((item) => item.id),
			position,
			total: MAILBOXES.length,
			limit: 2,
		}));
		const list = await transport.mailboxes();
		expect(list.map((item) => item.id)).toEqual(MAILBOXES.map((item) => item.id));
		expect(server.argsOf('Mailbox/query').map((args) => args.position ?? 0)).toEqual([0, 2, 4]);
	});

	it('stops paging a server that never moves past its first page', async () => {
		const { server, transport } = paged(() => ({
			ids: ['MBinbox', DRAFTS],
			position: 0,
			total: 5,
		}));
		const list = await transport.mailboxes();
		expect(list.map((item) => item.id)).toEqual(['MBinbox', DRAFTS]);
		// The second page brought no id it did not have: asking on would never end.
		expect(server.argsOf('Mailbox/query')).toHaveLength(2);
	});

	it('creates and renames with Mailbox/set', async () => {
		const { server, transport } = setup();
		server.on('Mailbox/set', (args) =>
			args.create
				? {
						created: {
							mailbox: { id: 'MBnew', sortOrder: 7, totalEmails: 0, unreadEmails: 0, myRights: {} },
						},
					}
				: { updated: { MBwork: null } },
		);
		expect(await transport.createMailbox({ name: 'Projects', parentId: 'MBwork' })).toEqual({
			id: 'MBnew',
			name: 'Projects',
			parentId: 'MBwork',
			role: null,
			sortOrder: 7,
			totalEmails: 0,
			unreadEmails: 0,
		});
		await transport.renameMailbox('MBwork', 'Clients');
		expect(server.argsOf('Mailbox/set')).toEqual([
			{ accountId: 'A13824', create: { mailbox: { name: 'Projects', parentId: 'MBwork' } } },
			{ accountId: 'A13824', update: { MBwork: { name: 'Clients' } } },
		]);
		server.on('Mailbox/set', () => ({ notUpdated: { MBwork: { type: 'forbidden' } } }));
		expect(await failure(transport.renameMailbox('MBwork', 'x'))).toMatchObject({
			code: 'forbidden',
		});
		server.on('Mailbox/set', () => ({
			notCreated: { mailbox: { type: 'invalidProperties', properties: ['name'] } },
		}));
		expect(await failure(transport.createMailbox({ name: '' }))).toMatchObject({ code: 'invalid' });
	});

	it('destroys a folder the person made and refuses any mailbox with a role', async () => {
		const { server, transport } = setup();
		server.on('Mailbox/set', () => ({ destroyed: ['MBwork'] }));
		await transport.destroyMailbox('MBwork');
		expect(server.argsOf('Mailbox/set')).toEqual([
			{ accountId: 'A13824', destroy: ['MBwork'], onDestroyRemoveEmails: false },
		]);
		expect(await failure(transport.destroyMailbox(DRAFTS))).toMatchObject({ code: 'forbidden' });
		expect(await failure(transport.destroyMailbox('MBall'))).toMatchObject({ code: 'forbidden' });
		expect(await failure(transport.destroyMailbox('gone'))).toMatchObject({ code: 'notFound' });
		expect(server.argsOf('Mailbox/set')).toHaveLength(1);
		server.on('Mailbox/set', () => responseArgs(mailbox.setResponse));
		server.on('Mailbox/get', () => ({
			state: 'M1',
			list: [{ id: 'MB23cfa8094c0f41e6', role: null }],
		}));
		expect(await failure(transport.destroyMailbox('MB23cfa8094c0f41e6'))).toMatchObject({
			code: 'forbidden',
			type: 'forbidden',
		});
		server.on('Mailbox/set', () => ({
			notDestroyed: { MB23cfa8094c0f41e6: { type: 'mailboxHasEmail' } },
		}));
		expect(await failure(transport.destroyMailbox('MB23cfa8094c0f41e6'))).toMatchObject({
			code: 'invalid',
		});
	});
});

describe('query', () => {
	it('sends the filter, newest first, with the page and a total', async () => {
		const { server, transport } = setup();
		server.on('Email/query', () => responseArgs(email.query.response[0]));
		const result = await transport.query(
			{ ...parseSearch('from:ada report'), mailboxId: 'fb666a55' },
			{ position: 0, limit: 30 },
		);
		expect(result).toEqual({
			ids: ['Ma783e5cdf5f2deffbc97930a', 'M9bd17497e2a99cb345fc1d0a'],
			total: 115,
			position: 0,
		});
		expect(server.argsOf('Email/query')).toEqual([
			{
				accountId: 'A13824',
				filter: {
					operator: 'AND',
					conditions: [{ inMailbox: 'fb666a55' }, { text: 'report' }, { from: 'ada' }],
				},
				sort: [{ property: 'receivedAt', isAscending: false }],
				position: 0,
				limit: 30,
				calculateTotal: true,
				collapseThreads: false,
			},
		]);
	});

	it('leaves the filter and limit out when there are none', async () => {
		const { server, transport } = setup();
		server.on('Email/query', () => ({ ids: ['a'], position: 0 }));
		expect(await transport.query({})).toEqual({ ids: ['a'], total: 1, position: 0 });
		expect(server.argsOf('Email/query')[0]).not.toHaveProperty('filter');
		expect(server.argsOf('Email/query')[0]).not.toHaveProperty('limit');
	});
});

describe('summaries', () => {
	it('asks for the header properties only, batched by maxObjectsInGet and maxCallsInRequest', async () => {
		const { server, transport } = setup();
		server.session = rfcSession();
		const core = (server.session.capabilities as Record<string, Record<string, unknown>>)[
			'urn:ietf:params:jmap:core'
		]!;
		core.maxObjectsInGet = 2;
		core.maxCallsInRequest = 2;
		server.on('Email/get', (args) => ({
			state: 'E1',
			list: (args.ids as string[])
				.filter((id) => id !== 'gone')
				.reverse()
				.map((id) => ({ id, subject: `S ${id}` })),
			notFound: [],
		}));
		const list = await transport.summaries(['e1', 'e2', 'gone', 'e4', 'e5', 'e1']);
		expect(list.map((summary) => summary.id)).toEqual(['e1', 'e2', 'e4', 'e5', 'e1']);
		expect(
			server.apiRequests().map((request) => request.methodCalls.map((call) => call[1].ids)),
		).toEqual([
			[
				['e1', 'e2'],
				['gone', 'e4'],
			],
			[['e5']],
		]);
		expect(server.argsOf('Email/get')[0]!.properties).toEqual(SUMMARY_PROPERTIES);
		expect(await transport.summaries([])).toEqual([]);
		expect(server.apiRequests()).toHaveLength(2);
	});
});

describe('message', () => {
	it('fetches the bodies and attachments of one message', async () => {
		const { server, transport } = setup();
		server.on('Email/get', () => responseArgs(email.get.response));
		const message = await transport.message('f123u457');
		expect(message).toMatchObject({
			id: 'f123u457',
			subject: 'Dinner on Thursday?',
			html: '<html><body><p>Hello ...<div>-- Sent by your friendly mailing list ...</div>',
		});
		expect(server.argsOf('Email/get')).toEqual([
			{
				accountId: 'A13824',
				ids: ['f123u457'],
				properties: [...SUMMARY_PROPERTIES, 'bodyValues', 'textBody', 'htmlBody', 'attachments'],
				bodyProperties: [
					'partId',
					'blobId',
					'size',
					'name',
					'type',
					'charset',
					'disposition',
					'cid',
				],
				fetchTextBodyValues: true,
				fetchHTMLBodyValues: true,
				maxBodyValueBytes: 2 * 1024 * 1024,
			},
		]);
		expect(await failure(transport.message('f123u456'))).toMatchObject({ code: 'notFound' });
	});

	/** An Email/get whose one text part is cut to 8 bytes whenever `maxBodyValueBytes` is set. */
	const cutting =
		(keywords: Record<string, boolean>, whole: string) => (args: Record<string, unknown>) => ({
			state: 'E1',
			list: [
				{
					id: (args.ids as string[])[0],
					keywords,
					textBody: [{ partId: '1', type: 'text/plain' }],
					bodyValues: {
						'1': args.maxBodyValueBytes
							? { value: whole.slice(0, 8), isTruncated: true }
							: { value: whole, isTruncated: false },
					},
				},
			],
		});

	it('fetches a draft the limit cut short again whole, since editing saves it back', async () => {
		const { server, transport } = setup();
		const whole = 'Draft text that runs past the limit.';
		server.on('Email/get', cutting({ $draft: true, $seen: true }, whole));
		expect((await transport.message('d1')).text).toBe(whole);
		expect(server.argsOf('Email/get').map((args) => args.maxBodyValueBytes)).toEqual([
			2 * 1024 * 1024,
			undefined,
		]);
	});

	it('marks a message the limit cut short, and fetches it whole when asked', async () => {
		const { server, transport } = setup();
		const whole = 'Received text past the limit.';
		server.on('Email/get', cutting({ $seen: true }, whole));
		expect(await transport.message('m1')).toMatchObject({ text: 'Received', truncated: true });
		const full = await transport.message('m1', { whole: true });
		expect(full.text).toBe(whole);
		expect(full).not.toHaveProperty('truncated');
		expect(server.argsOf('Email/get').map((args) => args.maxBodyValueBytes)).toEqual([
			2 * 1024 * 1024,
			undefined,
		]);
		// A server that cuts even when asked for whole values: nothing to quote or edit from.
		server.on('Email/get', () => ({
			state: 'E1',
			list: [
				{
					id: 'm1',
					keywords: { $seen: true },
					textBody: [{ partId: '1', type: 'text/plain' }],
					bodyValues: { '1': { value: 'Cut', isTruncated: true } },
				},
			],
		}));
		expect(await failure(transport.message('m1', { whole: true }))).toMatchObject({
			code: 'tooLarge',
		});
	});

	it('keeps other messages to the limit and refuses a draft the server still cuts', async () => {
		const { server, transport } = setup();
		server.on('Email/get', cutting({ $seen: true }, 'Received text past the limit.'));
		expect((await transport.message('m1')).text).toBe('Received');
		expect(server.argsOf('Email/get')).toHaveLength(1);
		// A server that cuts even when asked for whole values: the draft is not handed out cut.
		server.on('Email/get', () => ({
			state: 'E1',
			list: [
				{
					id: 'd1',
					keywords: { $draft: true },
					textBody: [{ partId: '1', type: 'text/plain' }],
					bodyValues: { '1': { value: 'Cut', isTruncated: true } },
				},
			],
		}));
		expect(await failure(transport.message('d1'))).toMatchObject({ code: 'tooLarge' });
		expect(server.argsOf('Email/get').map((args) => args.maxBodyValueBytes)).toEqual([
			2 * 1024 * 1024,
			2 * 1024 * 1024,
			undefined,
		]);
	});
});

describe('update and destroy', () => {
	it('patches keywords and mailboxes, as the RFC 8621 4.10 mark-unread does', async () => {
		const { server, transport } = setup();
		server.on('Email/set', (args) => ({
			updated: Object.fromEntries(Object.keys(args.update as object).map((id) => [id, null])),
		}));
		await transport.update({ Ma783e5cdf5f2deffbc97930a: { keywords: { $seen: false } } });
		expect(server.argsOf('Email/set')[0]!.update).toEqual(
			responseArgs(email.markUnread.request).update,
		);
		await transport.update({
			a: {
				keywords: { $flagged: true, 'odd/key~': true },
				mailboxIds: { MBinbox: false, MBwork: true },
			},
			b: {},
		});
		expect(server.argsOf('Email/set')[1]!.update).toEqual({
			a: {
				'keywords/$flagged': true,
				'keywords/odd~1key~0': true,
				'mailboxIds/MBinbox': null,
				'mailboxIds/MBwork': true,
			},
		});
		server.on('Email/set', () => ({ notUpdated: { a: { type: 'tooManyKeywords' } } }));
		expect(await failure(transport.update({ a: { keywords: { x: true } } }))).toMatchObject({
			code: 'invalid',
			type: 'tooManyKeywords',
		});
	});

	it('destroys in batches of maxObjectsInSet and treats already gone as done', async () => {
		const { server, transport } = setup();
		server.session = rfcSession();
		(server.session.capabilities as Record<string, Record<string, unknown>>)[
			'urn:ietf:params:jmap:core'
		]!.maxObjectsInSet = 2;
		server.on('Email/set', (args) => ({
			destroyed: (args.destroy as string[]).filter((id) => id !== 'x'),
			notDestroyed: (args.destroy as string[]).includes('x') ? { x: { type: 'notFound' } } : null,
		}));
		await transport.destroy(['a', 'b', 'x', 'a']);
		expect(server.argsOf('Email/set').map((args) => args.destroy)).toEqual([['a', 'b'], ['x']]);
		server.on('Email/set', () => ({ notDestroyed: { a: { type: 'forbidden' } } }));
		expect(await failure(transport.destroy(['a']))).toMatchObject({ code: 'forbidden' });
	});
});

describe('close', () => {
	it('refuses calls afterwards and aborts what is in flight', async () => {
		const { server, transport } = setup();
		await transport.connect();
		let release!: () => void;
		server.route(
			(request) => request.method === 'POST',
			() =>
				new Promise<Response>((resolve) => {
					release = () => resolve(new Response('{}'));
				}),
		);
		const pending = transport.mailboxes();
		await new Promise((resolve) => setImmediate(resolve));
		transport.close();
		expect(await failure(pending)).toMatchObject({
			code: 'network',
			message: 'The transport is closed.',
		});
		release();
		expect(await failure(transport.mailboxes())).toMatchObject({ code: 'network' });
		expect(await failure(transport.connect())).toMatchObject({ code: 'network' });
		expect(transport.watch(() => {})).toBeTypeOf('function');
	});
});
