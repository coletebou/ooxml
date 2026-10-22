import type { Draft } from '../model';
import type { JmapAuth } from './http';
import { createClock } from './test-support/clock';
import { createFakeServer, json, until } from './test-support/fake-server';
import { installMailStore } from './test-support/mail-store';
import { failure, setup } from './test-support/setup';

const BEARER: JmapAuth = { type: 'bearer', token: 'tok-SECRET-1' };
const BASIC: JmapAuth = {
	type: 'basic',
	username: 'joe@example.com',
	password: 'pässwörd-SECRET-2',
};
const BASIC_VALUE = Buffer.from('joe@example.com:pässwörd-SECRET-2', 'utf8').toString('base64');

const cases = [
	{
		name: 'bearer',
		auth: BEARER,
		header: 'Bearer tok-SECRET-1',
		secrets: ['tok-SECRET-1', 'SECRET-1'],
	},
	{
		name: 'basic',
		auth: BASIC,
		header: `Basic ${BASIC_VALUE}`,
		secrets: ['pässwörd-SECRET-2', 'SECRET-2', BASIC_VALUE, 'joe@example.com:pässwörd'],
	},
	{
		name: 'bearer function',
		auth: { type: 'bearer', token: () => 'tok-SECRET-3' } satisfies JmapAuth,
		header: 'Bearer tok-SECRET-3',
		secrets: ['tok-SECRET-3', 'SECRET-3'],
	},
	{
		name: 'bearer async function',
		auth: { type: 'bearer', token: async () => 'tok-SECRET-4' } satisfies JmapAuth,
		header: 'Bearer tok-SECRET-4',
		secrets: ['tok-SECRET-4', 'SECRET-4'],
	},
];

const draft: Draft = {
	to: [{ name: '', email: 'ann@example.com' }],
	cc: [],
	bcc: [],
	subject: 'Hi',
	text: 'Hello',
	attachments: [],
};

/** Every text an error carries: message, `String`, stack, details and its causes, all the way down. */
function texts(error: unknown, depth = 0): string[] {
	if (!(error instanceof Error)) return [String(error)];
	const details = (error as { details?: unknown }).details;
	return [
		error.message,
		String(error),
		error.stack ?? '',
		JSON.stringify(details ?? {}),
		...(depth < 6 && error.cause !== undefined ? texts(error.cause, depth + 1) : []),
	];
}

describe.each(cases)('$name credentials', ({ auth, header, secrets }) => {
	it('go with every request in the Authorization header and never into a URL', async () => {
		const clock = createClock();
		const { server, transport } = setup({ auth, clock, push: 'auto' });
		installMailStore(server);
		server.on('Email/query', () => ({ ids: [], position: 0, total: 0 }));
		server.on('Email/get', () => ({ state: 'E1', list: [] }));
		server.route(
			(request) => request.url.startsWith('https://jmap.example.com/download/'),
			() => new Response(new Uint8Array([1])),
		);
		await transport.connect();
		await transport.mailboxes();
		await transport.query({ text: 'x' });
		await transport.summaries(['a']);
		const { blobId } = await transport.upload(new Uint8Array([1, 2]), 'image/png');
		await transport.download(blobId, { type: 'image/png', name: 'a.png' });
		await transport.saveDraft(draft);
		await transport.send(draft);
		const stop = transport.watch(() => {});
		await until(() => server.streams.length === 1);
		stop();
		const kinds = new Set(
			server.requests.map(
				(request) => `${request.method} ${new URL(request.url).pathname.split('/')[1]}`,
			),
		);
		expect([...kinds].sort()).toEqual([
			'GET .well-known',
			'GET download',
			'GET eventsource',
			'POST api',
			'POST upload',
		]);
		for (const request of server.requests) {
			expect(request.headers.authorization).toBe(header);
			for (const secret of secrets) expect(decodeURIComponent(request.url)).not.toContain(secret);
		}
	});

	it.each([
		[
			'a 401 whose problem details quote the credentials',
			() => json({ type: 'about:blank', status: 401, detail: `Bad credentials: ${header}` }, 401),
		],
		[
			'a 500 that echoes them in its body',
			() => new Response(`crash for ${header} / ${secrets[0]}`, { status: 500 }),
		],
		[
			'a body that is not JSON',
			() => new Response(`<html>${secrets[0]} ${header}</html>`, { status: 200 }),
		],
	])('are not in any error after %s', async (_label, respond) => {
		for (const target of ['session', 'api'] as const) {
			const server = createFakeServer();
			if (target === 'session') server.route(() => true, respond);
			const { transport } = setup({ auth, server });
			if (target === 'api') {
				await transport.connect();
				server.route((request) => request.method === 'POST', respond);
			}
			const error = await failure(transport.mailboxes());
			for (const text of texts(error))
				for (const secret of secrets) expect(text).not.toContain(secret);
		}
	});

	it('are not in the error of a network failure, even when the platform error quotes them', async () => {
		const server = createFakeServer();
		const { transport } = setup({
			auth,
			server,
			fetch: async () => {
				throw new TypeError(`fetch failed (Authorization: ${header})`, {
					cause: new Error(`connect ECONNREFUSED while sending ${secrets[0]}`),
				});
			},
		});
		const error = await failure(transport.connect());
		expect(error).toMatchObject({ code: 'network' });
		const all = texts(error);
		expect(all.join('\n')).toContain('[redacted]');
		for (const text of all) for (const secret of secrets) expect(text).not.toContain(secret);
	});
});

describe('a bearer token a header cannot carry', () => {
	it('is refused before any request, without being quoted', async () => {
		const server = createFakeServer();
		const { transport } = setup({ server, auth: { type: 'bearer', token: 'line\nbreak-SECRET' } });
		const error = await failure(transport.connect());
		expect(error).toMatchObject({ code: 'unauthorized' });
		for (const text of texts(error)) expect(text).not.toContain('SECRET');
		expect(server.requests).toEqual([]);
	});
});

describe('a bearer token from a function', () => {
	it('is asked for before each request, so a token refreshed meanwhile goes with the next', async () => {
		let token = 'tok-OLD-SECRET';
		const { server, transport } = setup({ auth: { type: 'bearer', token: () => token } });
		installMailStore(server);
		await transport.connect();
		const first = server.requests.length;
		token = 'tok-NEW-SECRET';
		await transport.mailboxes();
		const headers = server.requests.map((request) => request.headers.authorization);
		expect(headers.slice(0, first).every((h) => h === 'Bearer tok-OLD-SECRET')).toBe(true);
		expect(headers.slice(first)).toEqual(['Bearer tok-NEW-SECRET']);
		// Both are scrubbed from what an error says: the one sent last and the one before.
		server.route(
			(request) => request.method === 'POST',
			() => new Response('denied tok-OLD-SECRET and tok-NEW-SECRET', { status: 500 }),
		);
		const error = await failure(transport.mailboxes());
		for (const text of texts(error)) expect(text).not.toContain('SECRET');
	});

	it('that fails, or gives what a header cannot carry, sends nothing and is not quoted', async () => {
		const failing = [
			() => {
				throw new Error('refresh failed with rt-SECRET');
			},
			async () => Promise.reject(new Error('refresh failed with rt-SECRET')),
			() => '',
			() => 'line\nbreak-SECRET',
			() => 42 as unknown as string,
		];
		for (const token of failing) {
			const server = createFakeServer();
			const { transport } = setup({ server, auth: { type: 'bearer', token } });
			const error = await failure(transport.connect());
			expect(error).toMatchObject({ code: 'unauthorized' });
			for (const text of texts(error)) expect(text).not.toContain('SECRET');
			expect(server.requests).toEqual([]);
		}
	});
});
