import { MailTransportError } from '../transport';
import { createJmapClient } from './client';
import { sessionResourceUrl } from './urls';
import { accountHas, discoverJmapSession, mailAccountId, parseJmapSession } from './session';
import {
	createFakeServer,
	json,
	redirectedTo,
	rfcSession,
	type FakeServer,
	type Recorded,
} from './test-support/fake-server';
import { MAIL, SUBMISSION } from './types';

const auth = { type: 'bearer', token: 'tok-SECRET-1' } as const;

async function failure(promise: Promise<unknown>): Promise<MailTransportError> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof MailTransportError) return error;
		throw error;
	}
	throw new Error('expected a failure');
}

describe('discoverJmapSession', () => {
	it('reads the RFC 8620 2.1 session from /.well-known/jmap of an origin', async () => {
		const server = createFakeServer({ session: rfcSession({ submission: false }) });
		const session = await discoverJmapSession({
			url: 'https://jmap.example.com',
			auth,
			fetch: server.fetch,
		});
		expect(server.requests).toHaveLength(1);
		expect(server.requests[0]).toMatchObject({
			method: 'GET',
			url: 'https://jmap.example.com/.well-known/jmap',
		});
		expect(server.requests[0]!.headers.authorization).toBe('Bearer tok-SECRET-1');
		expect(session).toMatchObject({
			url: 'https://jmap.example.com/.well-known/jmap',
			apiUrl: 'https://jmap.example.com/api/',
			downloadUrl: 'https://jmap.example.com/download/{accountId}/{blobId}/{name}?accept={type}',
			uploadUrl: 'https://jmap.example.com/upload/{accountId}/',
			eventSourceUrl:
				'https://jmap.example.com/eventsource/?types={types}&closeafter={closeafter}&ping={ping}',
			state: '75128aab4b1b',
			username: 'john@example.com',
			limits: {
				maxSizeUpload: 50_000_000,
				maxConcurrentUpload: 8,
				// The example spells it `maxConcurrentRequest`; section 2 names it with an `s`.
				maxConcurrentRequests: 8,
				maxCallsInRequest: 32,
				maxObjectsInGet: 256,
				maxObjectsInSet: 128,
			},
		});
		expect(session.accounts.A13824).toMatchObject({
			name: 'john@example.com',
			isPersonal: true,
			isReadOnly: false,
		});
		expect(session.accounts.A97813).toMatchObject({ isPersonal: false, isReadOnly: true });
		expect(mailAccountId(session)).toBe('A13824');
		expect(accountHas(session, 'A13824', MAIL)).toBe(true);
		expect(accountHas(session, 'A13824', SUBMISSION)).toBe(false);
	});

	it('uses a session resource URL as given', async () => {
		const server = createFakeServer({ sessionUrl: 'https://mail.example.org/jmap/session' });
		await discoverJmapSession({
			url: 'https://mail.example.org/jmap/session',
			auth,
			fetch: server.fetch,
		});
		expect(server.requests[0]!.url).toBe('https://mail.example.org/jmap/session');
		expect(sessionResourceUrl('jmap.example.com')).toBe(
			'https://jmap.example.com/.well-known/jmap',
		);
		expect(sessionResourceUrl(' https://jmap.example.com/ ')).toBe(
			'https://jmap.example.com/.well-known/jmap',
		);
	});

	it('resolves relative endpoints against the session URL and keeps template variables', () => {
		const session = parseJmapSession(
			{
				...rfcSession(),
				apiUrl: '/jmap/api/',
				downloadUrl: 'download/{accountId}/{blobId}/{name}?type={type}',
				uploadUrl: '//files.example.org/up/{accountId}',
				eventSourceUrl: '../events?types={types}&closeafter={closeafter}&ping={ping}',
			},
			'https://mail.example.org/jmap/session/',
		);
		expect(session.apiUrl).toBe('https://mail.example.org/jmap/api/');
		expect(session.downloadUrl).toBe(
			'https://mail.example.org/jmap/session/download/{accountId}/{blobId}/{name}?type={type}',
		);
		expect(session.uploadUrl).toBe('https://files.example.org/up/{accountId}');
		expect(session.eventSourceUrl).toBe(
			'https://mail.example.org/jmap/events?types={types}&closeafter={closeafter}&ping={ping}',
		);
	});

	it('refuses a server without the core or mail capability', () => {
		const noMail = rfcSession();
		delete (noMail.capabilities as Record<string, unknown>)[MAIL];
		expect(() => parseJmapSession(noMail, 'https://jmap.example.com/')).toThrow(
			expect.objectContaining({ code: 'unsupported' }),
		);
		const noCore = rfcSession();
		delete (noCore.capabilities as Record<string, unknown>)['urn:ietf:params:jmap:core'];
		expect(() => parseJmapSession(noCore, 'https://jmap.example.com/')).toThrow(
			expect.objectContaining({ code: 'unsupported' }),
		);
		expect(() =>
			parseJmapSession({ ...rfcSession(), apiUrl: 7 }, 'https://jmap.example.com/'),
		).toThrow(expect.objectContaining({ code: 'server' }));
	});

	it('refuses an answer that is not a session', async () => {
		const server = createFakeServer();
		server.route(
			() => true,
			() => new Response('<html>Welcome</html>', { headers: { 'Content-Type': 'text/html' } }),
		);
		const error = await failure(
			discoverJmapSession({ url: 'jmap.example.com', auth, fetch: server.fetch }),
		);
		expect(error.code).toBe('unsupported');
		expect(error.message).toMatch(/JMAP session/);
	});

	it('maps HTTP failures of the session resource', async () => {
		const server = createFakeServer();
		server.route(
			() => true,
			() => json({ type: 'about:blank', status: 401 }, 401),
		);
		const error = await failure(
			discoverJmapSession({ url: 'jmap.example.com', auth, fetch: server.fetch }),
		);
		expect(error.code).toBe('unauthorized');
	});

	it('only sends credentials over https, or http to a loopback host', async () => {
		const server = createFakeServer({ sessionUrl: 'http://localhost:8080/.well-known/jmap' });
		const insecure = await failure(
			discoverJmapSession({ url: 'http://jmap.example.com', auth, fetch: server.fetch }),
		);
		expect(insecure.code).toBe('invalid');
		expect(server.requests).toHaveLength(0);
		server.session = { ...rfcSession(), apiUrl: 'http://localhost:8080/api/' };
		const local = await discoverJmapSession({
			url: 'http://localhost:8080',
			auth,
			fetch: server.fetch,
		});
		expect(local.apiUrl).toBe('http://localhost:8080/api/');
		server.session = { ...rfcSession(), apiUrl: 'http://jmap.example.com/api/' };
		expect(
			(
				await failure(
					discoverJmapSession({ url: 'http://localhost:8080', auth, fetch: server.fetch }),
				)
			).code,
		).toBe('invalid');
		server.session = { ...rfcSession(), eventSourceUrl: 'http://jmap.example.com/events' };
		const withoutPush = await discoverJmapSession({
			url: 'http://localhost:8080',
			auth,
			fetch: server.fetch,
		});
		expect(withoutPush.eventSourceUrl).toBeNull();
	});

	it('refuses credentials in the server address', async () => {
		const server = createFakeServer();
		// Built with the URL API, so the fake credentials never sit in the source as a literal address.
		const withCredentials = new URL('https://jmap.example.com');
		withCredentials.username = 'john';
		withCredentials.password = 'hunter2';
		const error = await failure(
			discoverJmapSession({
				url: withCredentials.href,
				auth,
				fetch: server.fetch,
			}),
		);
		expect(error.code).toBe('invalid');
		expect(error.message).not.toContain('hunter2');
		expect(server.requests).toHaveLength(0);
	});

	it('asks a cross-origin redirect target itself when the redirect dropped Authorization', async () => {
		const server = createFakeServer({ sessionUrl: 'https://api.example.net/jmap/session' });
		server.route(
			(request) => request.url === 'https://jmap.example.com/.well-known/jmap',
			() => {
				const response = json({ type: 'about:blank', status: 401 }, 401);
				Object.defineProperty(response, 'redirected', { value: true });
				Object.defineProperty(response, 'url', { value: 'https://api.example.net/jmap/session' });
				return response;
			},
		);
		const session = await discoverJmapSession({
			url: 'jmap.example.com',
			auth,
			fetch: server.fetch,
		});
		expect(session.state).toBe('75128aab4b1b');
		expect(server.requests.map((request) => request.url)).toEqual([
			'https://jmap.example.com/.well-known/jmap',
			'https://api.example.net/jmap/session',
		]);
		expect(server.requests[1]!.headers.authorization).toBe('Bearer tok-SECRET-1');
	});

	it('refuses a session a redirect took to plain http, whatever endpoints it names', async () => {
		const server = createFakeServer();
		// Whoever answers on the http hop can name endpoints of their own, over https.
		server.route(
			(request) => request.url === 'https://jmap.example.com/.well-known/jmap',
			() =>
				redirectedTo(
					'http://jmap.example.com/jmap/session',
					json({ ...rfcSession(), apiUrl: 'https://attacker.example.net/api/' }),
				),
		);
		const error = await failure(
			discoverJmapSession({ url: 'jmap.example.com', auth, fetch: server.fetch }),
		);
		expect(error.code).toBe('invalid');
		expect(error.message).not.toContain('tok-SECRET-1');
		expect(() => parseJmapSession(rfcSession(), 'http://jmap.example.com/jmap/session')).toThrow(
			expect.objectContaining({ code: 'invalid' }),
		);
		// http stays fine on a loopback host, for development.
		const local = { ...rfcSession(), apiUrl: 'http://127.0.0.1:8080/api/' };
		expect(parseJmapSession(local, 'http://127.0.0.1:8080/jmap').url).toBe(
			'http://127.0.0.1:8080/jmap',
		);
	});

	it('never sends the credentials to where a redirect to http left the session', async () => {
		const server = createFakeServer();
		server.route(
			(request) => request.url === 'https://jmap.example.com/.well-known/jmap',
			() => redirectedTo('http://jmap.example.com/jmap/session', json(rfcSession())),
		);
		// Every API response then names another session state, which asks for a refetch.
		server.sessionState = 'changed';
		const client = createJmapClient({ url: 'jmap.example.com', auth, fetch: server.fetch });
		for (let attempt = 0; attempt < 2; attempt++)
			await client.request((builder) => builder.call('Core/echo', {})).catch(() => undefined);
		expect(server.requests.length).toBeGreaterThan(0);
		expect(server.requests.filter((request) => !request.url.startsWith('https:'))).toEqual([]);
	});

	it('takes the RFC minimums for limits the server leaves out', () => {
		const session = rfcSession();
		(session.capabilities as Record<string, unknown>)['urn:ietf:params:jmap:core'] = {};
		expect(parseJmapSession(session, 'https://jmap.example.com/').limits).toEqual({
			maxSizeUpload: Number.POSITIVE_INFINITY,
			maxConcurrentUpload: 4,
			maxConcurrentRequests: 4,
			maxCallsInRequest: 16,
			maxObjectsInGet: 500,
			maxObjectsInSet: 500,
		});
	});

	it('reads how many requests and uploads the server takes at once', () => {
		const limits = (core: Record<string, unknown>) => {
			const session = rfcSession();
			(session.capabilities as Record<string, unknown>)['urn:ietf:params:jmap:core'] = core;
			const { maxConcurrentRequests, maxConcurrentUpload } = parseJmapSession(
				session,
				'https://jmap.example.com/',
			).limits;
			return [maxConcurrentRequests, maxConcurrentUpload];
		};
		expect(limits({ maxConcurrentRequests: 2, maxConcurrentUpload: 1 })).toEqual([2, 1]);
		// The name section 2 gives wins over the spelling of the example in 2.1.
		expect(limits({ maxConcurrentRequests: 3, maxConcurrentRequest: 9 })).toEqual([3, 4]);
		expect(limits({ maxConcurrentRequest: 2 })).toEqual([2, 4]);
		// No request could ever go at zero, and a limit is a whole number.
		expect(limits({ maxConcurrentRequests: 0, maxConcurrentUpload: 1.5 })).toEqual([4, 4]);
		expect(limits({ maxConcurrentRequests: '2', maxConcurrentUpload: null })).toEqual([4, 4]);
	});
});

describe('discoverJmapSession through redirects', () => {
	const WELL_KNOWN = 'https://jmap.example.com/.well-known/jmap';
	const HTTP_HOP = 'http://jmap.example.com/jmap/session';
	const ATTACKER = 'https://attacker.example.net/jmap/session';
	const API = 'https://api.example.net/jmap/session';

	/** A valid session whose endpoints are on the attacker's own https server. */
	const attackerSession = (): Record<string, unknown> => ({
		...rfcSession(),
		apiUrl: 'https://attacker.example.net/api/',
		downloadUrl: 'https://attacker.example.net/download/{accountId}/{blobId}/{name}',
		uploadUrl: 'https://attacker.example.net/upload/{accountId}/',
	});
	/** Serves `session` at `url` to a request with credentials, and asks for them (401) otherwise. */
	const asksForCredentials = (
		server: FakeServer,
		url: string,
		session: Record<string, unknown>,
	): void =>
		server.route(
			(request) => request.url === url,
			(request) =>
				request.headers.authorization
					? json(session)
					: json({ type: 'about:blank', status: 401 }, 401),
		);
	const urls = (requests: readonly Recorded[]): string[] => requests.map((request) => request.url);
	/** Where the credentials went, in order. */
	const credentialsSentTo = (requests: readonly Recorded[]): string[] =>
		urls(requests.filter((request) => request.headers.authorization !== undefined));

	it('refuses a hop to plain http before taking it, though the chain comes back to https', async () => {
		const server = createFakeServer();
		// An on-path attacker answers the http hop with a redirect to a server of their own, which
		// asks for the credentials.
		server.redirect(WELL_KNOWN, HTTP_HOP);
		server.redirect(HTTP_HOP, ATTACKER);
		asksForCredentials(server, ATTACKER, attackerSession());
		const outcome = await discoverJmapSession({
			url: 'jmap.example.com',
			auth,
			fetch: server.fetch,
		}).catch((error: unknown) => error);
		expect(credentialsSentTo(server.requests)).toEqual([WELL_KNOWN]);
		expect(urls(server.requests)).toEqual([WELL_KNOWN]);
		expect(outcome).toMatchObject({ code: 'invalid' });
		expect(String((outcome as Error).message)).not.toContain('tok-SECRET-1');
	});

	it('never sends the credentials where a session found past an http hop points', async () => {
		const server = createFakeServer();
		server.redirect(WELL_KNOWN, HTTP_HOP);
		server.redirect(HTTP_HOP, ATTACKER);
		// This one serves its session to anyone: the credentials would follow with the API calls.
		server.route(
			(request) => request.url.startsWith('https://attacker.example.net/'),
			(request) =>
				request.method === 'GET'
					? json(attackerSession())
					: json({ methodResponses: [], sessionState: '75128aab4b1b' }),
		);
		const client = createJmapClient({ url: 'jmap.example.com', auth, fetch: server.fetch });
		const outcome = await client
			.request((builder) => builder.call('Core/echo', {}))
			.catch((error: unknown) => error);
		expect(credentialsSentTo(server.requests)).toEqual([WELL_KNOWN]);
		expect(urls(server.requests)).toEqual([WELL_KNOWN]);
		expect(outcome).toMatchObject({ code: 'invalid' });
	});

	it('follows https redirects itself, keeping the credentials on the same origin', async () => {
		const server = createFakeServer({ sessionUrl: 'https://jmap.example.com/jmap/session' });
		server.redirect(WELL_KNOWN, '/jmap/', 301);
		server.redirect('https://jmap.example.com/jmap/', 'session', 308);
		const session = await discoverJmapSession({
			url: 'jmap.example.com',
			auth,
			fetch: server.fetch,
		});
		expect(session.url).toBe('https://jmap.example.com/jmap/session');
		expect(credentialsSentTo(server.requests)).toEqual([
			WELL_KNOWN,
			'https://jmap.example.com/jmap/',
			'https://jmap.example.com/jmap/session',
		]);
		// Plain http stays fine on a loopback host, for development.
		const local = createFakeServer({ sessionUrl: 'http://localhost:8080/jmap/session' });
		local.session = { ...rfcSession(), apiUrl: 'http://localhost:8080/api/' };
		local.redirect('http://localhost:8080/.well-known/jmap', '/jmap/session');
		const developing = await discoverJmapSession({
			url: 'http://localhost:8080',
			auth,
			fetch: local.fetch,
		});
		expect(developing.url).toBe('http://localhost:8080/jmap/session');
	});

	it('takes a cross-origin hop without the credentials, then asks that server with them', async () => {
		const server = createFakeServer({ sessionUrl: API });
		server.redirect(WELL_KNOWN, API);
		asksForCredentials(server, API, rfcSession());
		const session = await discoverJmapSession({
			url: 'jmap.example.com',
			auth,
			fetch: server.fetch,
		});
		expect(session.url).toBe(API);
		expect(urls(server.requests)).toEqual([WELL_KNOWN, API, API]);
		expect(credentialsSentTo(server.requests)).toEqual([WELL_KNOWN, API]);
	});

	it('lets a browser follow the redirects it hides, as it blocks plain http itself', async () => {
		const server = createFakeServer({ sessionUrl: API });
		server.runtime = 'browser';
		server.redirect(WELL_KNOWN, API);
		asksForCredentials(server, API, rfcSession());
		const session = await discoverJmapSession({
			url: 'jmap.example.com',
			auth,
			fetch: server.fetch,
		});
		expect(session.url).toBe(API);
		// Asked by hand first (the redirect comes back opaque), then followed, then asked again
		// with the credentials the cross-origin hop dropped.
		expect(urls(server.requests)).toEqual([WELL_KNOWN, WELL_KNOWN, API, API]);
		expect(credentialsSentTo(server.requests)).toEqual([WELL_KNOWN, WELL_KNOWN, API]);

		const attacked = createFakeServer();
		attacked.runtime = 'browser';
		attacked.redirect(WELL_KNOWN, HTTP_HOP);
		attacked.redirect(HTTP_HOP, ATTACKER);
		asksForCredentials(attacked, ATTACKER, attackerSession());
		const blocked = await failure(
			discoverJmapSession({ url: 'jmap.example.com', auth, fetch: attacked.fetch }),
		);
		expect(blocked.code).toBe('network');
		expect(urls(attacked.requests)).toEqual([WELL_KNOWN, WELL_KNOWN]);
	});

	it('refuses a hop to an address it may not send credentials to, or cannot read', async () => {
		// Built with the URL API, so the fake credentials never sit in the source as a literal address.
		const withCredentials = new URL('https://jmap.example.com/jmap/session');
		withCredentials.username = 'john';
		withCredentials.password = 'hunter2';
		for (const location of [withCredentials.href, HTTP_HOP, 'https://[jmap.example.com/']) {
			const server = createFakeServer();
			server.redirect(WELL_KNOWN, location);
			const error = await failure(
				discoverJmapSession({ url: 'jmap.example.com', auth, fetch: server.fetch }),
			);
			expect(error.code, location).toBe('invalid');
			expect(error.message).not.toContain('hunter2');
			expect(urls(server.requests), location).toEqual([WELL_KNOWN]);
		}
	});

	it('gives up on a redirect loop after a few hops', async () => {
		const server = createFakeServer();
		server.redirect(WELL_KNOWN, 'https://jmap.example.com/jmap/session');
		server.redirect('https://jmap.example.com/jmap/session', WELL_KNOWN);
		const error = await failure(
			discoverJmapSession({ url: 'jmap.example.com', auth, fetch: server.fetch }),
		);
		expect(error.code).toBe('server');
		// The first request and five redirects.
		expect(server.requests).toHaveLength(6);
	});
});

describe('mailAccountId', () => {
	const session = parseJmapSession(rfcSession(), 'https://jmap.example.com/.well-known/jmap');

	it('takes a requested account and refuses one the server does not have', () => {
		expect(mailAccountId(session, 'A97813')).toBe('A97813');
		expect(() => mailAccountId(session, 'nope')).toThrow(
			expect.objectContaining({ code: 'notFound' }),
		);
		expect(() => mailAccountId(session, 'constructor')).toThrow(
			expect.objectContaining({ code: 'notFound' }),
		);
	});

	it('refuses a requested account that offers no mail', () => {
		const raw = rfcSession();
		const contactsOnly = {
			...raw,
			accounts: {
				...(raw.accounts as Record<string, unknown>),
				X1: {
					name: 'Address book',
					isPersonal: true,
					isReadOnly: false,
					accountCapabilities: { 'urn:ietf:params:jmap:contacts': {} },
				},
			},
		};
		const parsed = parseJmapSession(contactsOnly, 'https://jmap.example.com/.well-known/jmap');
		expect(() => mailAccountId(parsed, 'X1')).toThrow(
			expect.objectContaining({ code: 'unsupported' }),
		);
		expect(mailAccountId(parsed, 'A97813')).toBe('A97813');
		// An account that names no capability supports none (RFC 8620 2), whatever the server does.
		for (const capabilities of [{}, undefined]) {
			const bare = parseJmapSession(
				{
					...raw,
					accounts: {
						...(raw.accounts as Record<string, unknown>),
						X2: {
							name: 'Bare',
							isPersonal: true,
							isReadOnly: false,
							accountCapabilities: capabilities,
						},
					},
				},
				'https://jmap.example.com/.well-known/jmap',
			);
			expect(() => mailAccountId(bare, 'X2'), String(capabilities)).toThrow(
				expect.objectContaining({ code: 'unsupported' }),
			);
		}
	});

	it('falls back to any account with mail when there is no primary one', () => {
		const other = parseJmapSession(
			{ ...rfcSession(), primaryAccounts: {} },
			'https://jmap.example.com/.well-known/jmap',
		);
		expect(mailAccountId(other)).toBe('A13824');
		const none = parseJmapSession(
			{ ...rfcSession(), primaryAccounts: {}, accounts: {} },
			'https://jmap.example.com/.well-known/jmap',
		);
		expect(() => mailAccountId(none)).toThrow(expect.objectContaining({ code: 'unsupported' }));
	});

	it('knows which capabilities an account has', () => {
		expect(accountHas(session, 'A13824', SUBMISSION)).toBe(true);
		expect(accountHas(session, 'A97813', SUBMISSION)).toBe(false);
	});
});
