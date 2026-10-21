import { createJmapClient } from './client';
import { createJmapHttp } from './http';
import { createFakeServer, json, type Recorded } from './test-support/fake-server';
import { AUTH, failure, setup, TOKEN } from './test-support/setup';

const ORIGIN = 'https://jmap.example.com';
const API = `${ORIGIN}/api/`;
const UPLOAD = `${ORIGIN}/upload/A13824/`;
const EVENTS = `${ORIGIN}/eventsource/`;
const MOVED = `${ORIGIN}/api/v2/`;
const OTHER = 'https://api.example.net/jmap/';
const PLAIN = 'http://jmap.example.com/api/';

/** What went out over plain http, where neither a body nor the credentials may ever go. */
const plain = (requests: readonly Recorded[]): Recorded[] =>
	requests.filter((request) => request.url.startsWith('http:'));
const posts = (requests: readonly Recorded[]): string[] =>
	requests.filter((request) => request.method === 'POST').map((request) => request.url);
/** What the API answers to a request that arrived where a redirect sent it. */
const echoed = (): Response =>
	json({ methodResponses: [['Core/echo', { hello: true }, '0']], sessionState: '75128aab4b1b' });
const client = (fetch: typeof globalThis.fetch) =>
	createJmapClient({ url: ORIGIN, auth: AUTH, fetch });
const echo = (jmap: ReturnType<typeof client>) =>
	jmap.request((builder) => builder.call('Core/echo', { hello: true }));

describe('redirects of API calls, uploads, downloads and push', () => {
	it('refuses an API call redirected to plain http before its body goes there', async () => {
		const { server, transport } = setup();
		server.redirect(API, PLAIN, 307);
		expect(await failure(transport.mailboxes())).toMatchObject({ code: 'invalid' });
		expect(plain(server.requests)).toEqual([]);
		expect(posts(server.requests)).toEqual([API]);
	});

	it('refuses an upload redirected to plain http, so the file never goes there', async () => {
		const { server, transport } = setup();
		server.redirect(UPLOAD, 'http://jmap.example.com/upload/A13824/', 308);
		const error = await failure(transport.upload(new Uint8Array([1, 2, 3]), 'image/png'));
		expect(error).toMatchObject({ code: 'invalid' });
		expect(error.message).not.toContain(TOKEN);
		expect(plain(server.requests)).toEqual([]);
	});

	it('refuses a download redirected to plain http', async () => {
		const { server, transport } = setup();
		server.route(
			(request) => request.url.startsWith(`${ORIGIN}/download/`),
			() =>
				new Response(null, { status: 302, headers: { Location: 'http://files.example.net/b' } }),
		);
		expect(
			await failure(transport.download('G1', { type: 'text/plain', name: 'a.txt' })),
		).toMatchObject({ code: 'invalid' });
		expect(plain(server.requests)).toEqual([]);
	});

	it('refuses an event source redirected to plain http', async () => {
		const server = createFakeServer();
		server.redirect(EVENTS, 'http://jmap.example.com/eventsource/');
		const http = createJmapHttp({ auth: AUTH, fetch: server.fetch });
		expect(
			await failure(http.open(EVENTS, { method: 'GET' }, 'The push connection')),
		).toMatchObject({ code: 'invalid' });
		expect(plain(server.requests)).toEqual([]);
	});

	it('follows a 307 on the same origin with the method, the body and the credentials', async () => {
		const server = createFakeServer();
		server.redirect(API, MOVED, 307);
		server.route((request) => request.url === MOVED, echoed);
		const { result, calls } = await echo(client(server.fetch));
		expect(result.get(calls)).toEqual({ hello: true });
		const [first, moved] = server.requests.filter((request) => request.method === 'POST');
		expect(moved).toMatchObject({ method: 'POST', url: MOVED, body: first!.body });
		expect(moved!.headers.authorization).toBe(`Bearer ${TOKEN}`);
	});

	it('leaves the credentials behind on a hop to another origin, as fetch does', async () => {
		const server = createFakeServer();
		server.redirect(API, OTHER, 308);
		server.route((request) => request.url === OTHER, echoed);
		await echo(client(server.fetch));
		const hop = server.requests.find((request) => request.url === OTHER);
		expect(hop).toMatchObject({ method: 'POST' });
		expect(hop!.headers.authorization).toBeUndefined();
	});

	it('goes on as a GET without the body after a 303, as fetch does', async () => {
		const server = createFakeServer();
		const result = `${ORIGIN}/result`;
		server.redirect(UPLOAD, result, 303);
		server.route(
			(request) => request.url === result,
			() => json({ ok: true }),
		);
		const http = createJmapHttp({ auth: AUTH, fetch: server.fetch });
		const init = {
			method: 'POST' as const,
			headers: { 'Content-Type': 'image/png', Accept: 'application/json' },
			body: new Uint8Array([1]),
		};
		expect(await http.exchange(UPLOAD, init, 'The upload', (r) => r.json())).toEqual({ ok: true });
		const hop = server.requests.at(-1)!;
		expect(hop).toMatchObject({ method: 'GET', url: result, body: null, bytes: null });
		expect(hop.headers['content-type']).toBeUndefined();
		expect(hop.headers.accept).toBe('application/json');
		expect(hop.headers.authorization).toBe(`Bearer ${TOKEN}`);
	});

	it('gives up after five redirects in a row', async () => {
		const server = createFakeServer();
		server.redirect(API, MOVED, 307);
		server.redirect(MOVED, API, 307);
		expect(await failure(echo(client(server.fetch)))).toMatchObject({ code: 'server' });
		// The first request and five redirects.
		expect(posts(server.requests)).toHaveLength(6);
	});

	it('lets a browser follow the redirects it hides, and leaves them to it from then on', async () => {
		const server = createFakeServer();
		server.runtime = 'browser';
		server.redirect(API, MOVED, 307);
		server.route((request) => request.url === MOVED, echoed);
		const jmap = client(server.fetch);
		await echo(jmap);
		// Asked by hand first (the redirect comes back opaque), then followed by the browser.
		expect(posts(server.requests)).toEqual([API, API, MOVED]);
		await echo(jmap);
		expect(posts(server.requests)).toEqual([API, API, MOVED, API, MOVED]);

		// A hop to plain http a browser blocks itself, as mixed content.
		const attacked = createFakeServer();
		attacked.runtime = 'browser';
		attacked.redirect(API, PLAIN, 307);
		expect(await failure(echo(client(attacked.fetch)))).toMatchObject({ code: 'network' });
		expect(plain(attacked.requests)).toEqual([]);
	});
});
