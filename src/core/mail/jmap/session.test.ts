import { MailTransportError } from '../transport';
import { createJmapClient } from './client';
import { sessionResourceUrl } from './http';
import { accountHas, discoverJmapSession, mailAccountId, parseJmapSession } from './session';
import { createFakeServer, json, rfcSession } from './test-support/fake-server';
import { MAIL, SUBMISSION } from './types';

const auth = { type: 'bearer', token: 'tok-SECRET-1' } as const;

/** `response` as fetch hands it back after following redirects to `url`. */
function redirectedTo(url: string, response: Response): Response {
	Object.defineProperty(response, 'redirected', { value: true });
	Object.defineProperty(response, 'url', { value: url });
	return response;
}

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
			maxCallsInRequest: 16,
			maxObjectsInGet: 500,
			maxObjectsInSet: 500,
		});
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
