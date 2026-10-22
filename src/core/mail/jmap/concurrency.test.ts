import { createJmapClient } from './client';
import { createJmapGate } from './http';
import { createFakeServer, flush, json } from './test-support/fake-server';
import { AUTH, failure, setup } from './test-support/setup';
import { CORE } from './types';

const API = 'https://jmap.example.com/api/';
const UPLOAD = 'https://jmap.example.com/upload/A13824/';

type Kind = 'api' | 'uploads';

interface Held {
	/** Answers as the server does. */
	answer(): void;
	/** Answers with a server error. */
	fail(): void;
}

/**
 * A server whose session says it takes at most `limits.api` API requests and `limits.uploads`
 * uploads at once, and that holds every answer to those until the test gives it. What is in flight
 * is counted around `fetch`, which settles when the answer comes or the request is aborted.
 */
function holdingServer(limits: Partial<Record<Kind, number>>) {
	const server = createFakeServer();
	const core = (server.session.capabilities as Record<string, Record<string, unknown>>)[CORE]!;
	if (limits.api !== undefined) core.maxConcurrentRequests = limits.api;
	if (limits.uploads !== undefined) core.maxConcurrentUpload = limits.uploads;
	const held: Held[] = [];
	let blobs = 0;
	const hold = (answer: () => Response): Promise<Response> =>
		new Promise((resolve) => {
			held.push({
				answer: () => resolve(answer()),
				fail: () => resolve(json({ type: 'about:blank', status: 500 }, 500)),
			});
		});
	server.route(
		(request) => request.method === 'POST' && request.url === API,
		(request) => hold(() => server.process(request)),
	);
	server.route(
		(request) => request.method === 'POST' && request.url === UPLOAD,
		(request) =>
			hold(() =>
				json({ accountId: 'A13824', blobId: `G${++blobs}`, size: request.bytes?.length ?? 0 }, 201),
			),
	);
	server.on('Email/get', (args) => ({
		state: 'E1',
		list: (args.ids as string[]).map((id) => ({
			id,
			keywords: { $seen: true },
			textBody: [{ partId: '1', type: 'text/plain' }],
			bodyValues: { '1': { value: `Body of ${id}`, isTruncated: false } },
		})),
	}));
	const inFlight: Record<Kind, number> = { api: 0, uploads: 0 };
	const most: Record<Kind, number> = { api: 0, uploads: 0 };
	const kindOf = (url: string, init?: RequestInit): Kind | null =>
		init?.method !== 'POST' ? null : url === API ? 'api' : url === UPLOAD ? 'uploads' : null;
	const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const kind = kindOf(String(input), init);
		if (kind) most[kind] = Math.max(most[kind], ++inFlight[kind]);
		try {
			return await server.fetch(input, init);
		} finally {
			if (kind) inFlight[kind]--;
		}
	}) as typeof globalThis.fetch;
	/** Answers the oldest held request. */
	const next = (how: 'answer' | 'fail' = 'answer'): void => {
		const first = held.shift();
		if (!first) throw new Error('Nothing is held.');
		first[how]();
	};
	return { server, fetch, held, inFlight, most, next };
}

describe('requests in flight at once', () => {
	it('opens five bodies at once with no more requests in flight than the server takes', async () => {
		const held = holdingServer({ api: 2 });
		const { transport } = setup({ server: held.server, fetch: held.fetch });
		const ids = ['m1', 'm2', 'm3', 'm4', 'm5'];
		const opened = ids.map((id) => transport.message(id));
		await flush();
		// Two went; the other three wait for one of them to come back.
		expect([held.inFlight.api, held.held.length]).toEqual([2, 2]);
		for (let answered = 1; answered <= ids.length; answered++) {
			held.next();
			await flush();
			expect(held.inFlight.api).toBe(Math.min(2, ids.length - answered));
		}
		const messages = await Promise.all(opened);
		expect(messages.map((message) => [message.id, message.text])).toEqual(
			ids.map((id) => [id, `Body of ${id}`]),
		);
		expect(held.most.api).toBe(2);
		expect(held.server.argsOf('Email/get').map((args) => args.ids)).toEqual(ids.map((id) => [id]));
	});

	it('frees the slot of a request that fails', async () => {
		const held = holdingServer({ api: 1 });
		const { transport } = setup({ server: held.server, fetch: held.fetch });
		const first = transport.message('m1');
		const second = transport.message('m2');
		await flush();
		expect(held.held).toHaveLength(1);
		held.next('fail');
		expect(await failure(first)).toMatchObject({ code: 'server', status: 500 });
		await flush();
		expect(held.inFlight.api).toBe(1);
		held.next();
		expect((await second).id).toBe('m2');
		expect(held.most.api).toBe(1);
	});

	it('frees the slot of a request that is aborted, and sends none aborted while it waits', async () => {
		const held = holdingServer({ api: 1 });
		const client = createJmapClient({
			url: 'https://jmap.example.com',
			auth: AUTH,
			fetch: held.fetch,
		});
		const echo = (word: string, signal?: AbortSignal) =>
			client.request((builder) => builder.call('Core/echo', { word }), signal);
		const sent = new AbortController();
		const waiting = new AbortController();
		const first = echo('first', sent.signal);
		const second = echo('second', waiting.signal);
		const third = echo('third');
		await flush();
		expect(held.inFlight.api).toBe(1);
		waiting.abort();
		expect(await failure(second)).toMatchObject({ name: 'AbortError' });
		sent.abort();
		expect(await failure(first)).toMatchObject({ name: 'AbortError' });
		await flush();
		// The aborted request's slot went to the third; the second never left.
		expect(held.inFlight.api).toBe(1);
		held.held.at(-1)!.answer();
		const { result, calls } = await third;
		expect(result.get(calls)).toEqual({ word: 'third' });
		expect(held.server.calls().map((call) => call[1].word)).toEqual(['first', 'third']);
		expect(held.most.api).toBe(1);
	});

	it('refuses the requests still waiting when the transport closes, and sends none of them', async () => {
		const held = holdingServer({ api: 1 });
		const { transport } = setup({ server: held.server, fetch: held.fetch });
		const opened = ['m1', 'm2', 'm3'].map((id) => transport.message(id));
		await flush();
		transport.close();
		for (const pending of opened)
			expect(await failure(pending)).toMatchObject({
				code: 'network',
				message: 'The transport is closed.',
			});
		expect(held.server.argsOf('Email/get')).toHaveLength(1);
	});

	it('keeps to the limit of a session the server changed', async () => {
		const held = holdingServer({ api: 1 });
		const client = createJmapClient({
			url: 'https://jmap.example.com',
			auth: AUTH,
			fetch: held.fetch,
		});
		const echo = () => client.request((builder) => builder.call('Core/echo', {}));
		const first = echo();
		await flush();
		// The answer names a new session state; the session read again takes three at once.
		held.server.sessionState = 'changed';
		(held.server.session.capabilities as Record<string, Record<string, unknown>>)[
			CORE
		]!.maxConcurrentRequests = 3;
		held.next();
		await first;
		const after = [echo(), echo(), echo(), echo()];
		await flush();
		expect([held.inFlight.api, held.most.api]).toEqual([3, 3]);
		while (held.held.length) {
			held.next();
			await flush();
		}
		await Promise.all(after);
	});

	it('uploads no more files at once than the server takes, a failed one freeing its slot', async () => {
		const held = holdingServer({ uploads: 1 });
		const { transport } = setup({ server: held.server, fetch: held.fetch });
		const files = [new Uint8Array([1]), new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])];
		const uploaded = files.map((bytes) => transport.upload(bytes, 'application/pdf'));
		await flush();
		expect([held.inFlight.uploads, held.held.length]).toEqual([1, 1]);
		held.next('fail');
		expect(await failure(uploaded[0]!)).toMatchObject({ code: 'server' });
		for (let left = 2; left > 0; left--) {
			await flush();
			expect(held.inFlight.uploads).toBe(1);
			held.next();
		}
		expect((await Promise.all(uploaded.slice(1))).map((blob) => blob.size)).toEqual([2, 3]);
		expect(held.most.uploads).toBe(1);
	});
});

describe('createJmapGate', () => {
	it('lets in as many as its limit, in turn, and frees a slot once however often it is freed', async () => {
		const gate = createJmapGate(() => 2);
		const entered: string[] = [];
		const enter = (name: string, signal?: AbortSignal) =>
			gate.enter(signal).then((free) => {
				entered.push(name);
				return free;
			});
		const a = enter('a');
		const b = enter('b');
		const c = enter('c');
		const aborted = new AbortController();
		const d = enter('d', aborted.signal);
		const e = enter('e');
		await flush();
		expect(entered).toEqual(['a', 'b']);
		const freeA = await a;
		freeA();
		freeA();
		await flush();
		// Freed twice, one slot: c went in, e still waits behind it.
		expect(entered).toEqual(['a', 'b', 'c']);
		aborted.abort();
		expect(await failure(d)).toMatchObject({ name: 'AbortError' });
		(await b)();
		await flush();
		expect(entered).toEqual(['a', 'b', 'c', 'e']);
		(await c)();
		(await e)();
		const already = new AbortController();
		already.abort();
		expect(await failure(gate.enter(already.signal))).toMatchObject({ name: 'AbortError' });
		await gate.enter().then((free) => free());
	});
});
