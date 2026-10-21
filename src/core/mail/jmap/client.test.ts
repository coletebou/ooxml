import rfc from './__fixtures__/rfc8620-requests.json';
import { chunk, createJmapClient } from './client';
import { createFakeServer, rfcSession } from './test-support/fake-server';
import { AUTH } from './test-support/setup';
import type { JmapInvocation } from './types';

const responses = rfc.threadReference.methodResponses as unknown as JmapInvocation[];

describe('createJmapClient', () => {
	it('runs the RFC 8620 3.7 thread example, the server resolving each back reference', async () => {
		const server = createFakeServer();
		const received: Record<string, unknown>[] = [];
		server.on('Email/query', () => responses[0]![1]);
		server.on('Thread/get', (args) => {
			received.push(args);
			return responses[2]![1];
		});
		server.on('Email/get', (args) => {
			received.push(args);
			return (args.properties as string[]).includes('threadId') ? responses[1]![1] : { list: [] };
		});
		const client = createJmapClient({
			url: 'https://jmap.example.com',
			auth: AUTH,
			fetch: server.fetch,
		});
		const { result, calls } = await client.request((builder, accountId) => {
			const query = builder.call('Email/query', {
				accountId,
				filter: { inMailbox: 'id_of_inbox' },
			});
			const threads = builder.call('Email/get', {
				accountId,
				ids: query.ref('/ids'),
				properties: ['threadId'],
			});
			const thread = builder.call('Thread/get', {
				accountId,
				ids: threads.ref('/list/*/threadId'),
			});
			return builder.call('Email/get', {
				accountId,
				ids: thread.ref('/list/*/emailIds'),
				properties: ['from', 'receivedAt', 'subject'],
			});
		});
		expect(client.accountId()).toBe('A13824');
		expect(result.get(calls)).toEqual({ list: [] });
		const [request] = server.apiRequests();
		expect(request!.using).toEqual([
			'urn:ietf:params:jmap:core',
			'urn:ietf:params:jmap:mail',
			'urn:ietf:params:jmap:submission',
		]);
		expect(server.requests.at(-1)!.headers['content-type']).toBe('application/json');
		expect(request!.methodCalls[3]![1]).toHaveProperty('#ids');
		// The ids each call ran with once the server resolved its `#ids`, as RFC 8620 3.7 walks them.
		expect(received.map((args) => args.ids)).toEqual([
			(responses[0]![1] as { ids: string[] }).ids,
			['trd194', 'trd114'],
			rfc.threadReference.resolvedIds,
		]);
	});

	it('packs batches into requests of maxCallsInRequest calls', async () => {
		const server = createFakeServer({ session: rfcSession() });
		(server.session.capabilities as Record<string, Record<string, unknown>>)[
			'urn:ietf:params:jmap:core'
		]!.maxCallsInRequest = 2;
		const seen: string[][] = [];
		server.on('Foo/get', (args) => ({ list: args.ids }));
		const client = createJmapClient({
			url: 'https://jmap.example.com',
			auth: AUTH,
			fetch: server.fetch,
		});
		await client.batch(
			['a', 'b', 'c', 'd', 'e'],
			() => 2,
			(builder, accountId, ids) => builder.call('Foo/get', { accountId, ids }),
			(result, call, ids) => {
				expect(result.get(call).list).toEqual(ids);
				seen.push([...ids]);
			},
		);
		expect(seen).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
		expect(server.apiRequests().map((request) => request.methodCalls.length)).toEqual([2, 1]);
	});
});

describe('chunk', () => {
	it('splits a list into runs of at most the given size', () => {
		expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
		expect(chunk([], 3)).toEqual([]);
	});
});
