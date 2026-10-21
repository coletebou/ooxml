import rfc from './__fixtures__/rfc8620-requests.json';
import { JmapError, createRedactor } from './errors';
import {
	JmapRequestBuilder,
	JmapResult,
	parseJmapResponse,
	patchPath,
	setErrors,
	type JmapCall,
} from './request';
import { evaluatePointer } from './test-support/fake-server';
import type { JmapInvocation } from './types';

const redact = createRedactor([]);
const using = ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'];

describe('JmapRequestBuilder', () => {
	it('writes the RFC 8620 3.7 thread example, back references and all', () => {
		const builder = new JmapRequestBuilder(using);
		const query = builder.call(
			'Email/query',
			{
				accountId: 'A1',
				filter: { inMailbox: 'id_of_inbox' },
				sort: [{ property: 'receivedAt', isAscending: false }],
				collapseThreads: true,
				position: 0,
				limit: 10,
				calculateTotal: true,
			},
			't0',
		);
		const threads = builder.call(
			'Email/get',
			{ accountId: 'A1', ids: query.ref('/ids'), properties: ['threadId'] },
			't1',
		);
		const thread = builder.call(
			'Thread/get',
			{ accountId: 'A1', ids: threads.ref('/list/*/threadId') },
			't2',
		);
		builder.call(
			'Email/get',
			{
				accountId: 'A1',
				ids: thread.ref('/list/*/emailIds'),
				properties: ['from', 'receivedAt', 'subject'],
			},
			't3',
		);
		const request = builder.build();
		expect(request.using).toEqual(using);
		expect(JSON.parse(JSON.stringify(request.methodCalls))).toEqual(
			rfc.threadReference.methodCalls,
		);
	});

	it('writes the simple 3.7 example, whose reference resolves to the created ids', () => {
		const builder = new JmapRequestBuilder(using);
		const changes = builder.call('Foo/changes', { accountId: 'A1', sinceState: 'abcdef' }, 't0');
		builder.call('Foo/get', { accountId: 'A1', ids: changes.ref('/created') }, 't1');
		expect(JSON.parse(JSON.stringify(builder.build().methodCalls))).toEqual(
			rfc.simpleReference.methodCalls,
		);
		const created = rfc.simpleReference.methodResponses[0]![1] as Record<string, unknown>;
		expect(evaluatePointer(created, ['created'])).toEqual(rfc.simpleReference.resolvedIds);
	});

	it('resolves the thread example the way RFC 8620 3.7 walks it', () => {
		const [, , threads] = rfc.threadReference.methodResponses as unknown as JmapInvocation[];
		expect(evaluatePointer(threads![1], ['list', '*', 'emailIds'])).toEqual(
			rfc.threadReference.resolvedIds,
		);
	});

	it('numbers calls "0", "1", ... and leaves out undefined arguments', () => {
		const builder = new JmapRequestBuilder(using);
		const first = builder.call('Email/query', {
			accountId: 'A',
			filter: undefined,
			limit: undefined,
		});
		const second = builder.call('Email/get', { accountId: 'A', ids: first.ref('/ids') });
		expect([first.id, second.id]).toEqual(['0', '1']);
		expect(builder.size).toBe(2);
		expect(builder.build().methodCalls).toEqual([
			['Email/query', { accountId: 'A' }, '0'],
			[
				'Email/get',
				{ accountId: 'A', '#ids': { resultOf: '0', name: 'Email/query', path: '/ids' } },
				'1',
			],
		]);
		expect(second.ref('/list', 'Other/name').toJSON()).toEqual({
			resultOf: '1',
			name: 'Other/name',
			path: '/list',
		});
	});
});

describe('parseJmapResponse', () => {
	it('reads the RFC 8620 3.4.1 example response', () => {
		const response = parseJmapResponse(rfc.exampleResponse);
		expect(response.sessionState).toBe('75128aab4b1b');
		expect(response.methodResponses).toHaveLength(4);
	});

	it('rejects a body that is not a Response object', () => {
		for (const body of [
			null,
			[],
			{},
			{ methodResponses: [['x', {}]] },
			{ methodResponses: [[1, {}, 'c']] },
		])
			expect(() => parseJmapResponse(body)).toThrow(expect.objectContaining({ code: 'server' }));
	});
});

describe('JmapResult', () => {
	const call = (id: string, name: string): JmapCall => ({
		id,
		name,
		ref: () => {
			throw new Error('unused');
		},
	});
	const result = new JmapResult(parseJmapResponse(rfc.exampleResponse), redact);

	it('reads each call of the 3.4.1 example, including the second response of c2', () => {
		expect(result.get(call('c1', 'method1'))).toEqual({ arg1: 3, arg2: 'foo' });
		expect(result.all(call('c2', 'method2')).map(([name]) => name)).toEqual([
			'method2',
			'anotherResponseFromMethod2',
		]);
		expect(result.get(call('c2', 'method2'), 'anotherResponseFromMethod2')).toEqual({
			data: 10,
			yetmoredata: 'Hello',
		});
	});

	it('throws the method-level error of c3 as a JmapError', () => {
		const error = result.error(call('c3', 'method3'));
		expect(error).toBeInstanceOf(JmapError);
		expect(error).toMatchObject({ code: 'unsupported', level: 'method', type: 'unknownMethod' });
		expect(() => result.get(call('c3', 'method3'))).toThrow(error!.message);
		expect(result.error(call('c1', 'method1'))).toBeNull();
	});

	it('throws when a call has no response of the expected name', () => {
		expect(() => result.get(call('c9', 'method9'))).toThrow(
			expect.objectContaining({ code: 'server' }),
		);
		expect(() => result.get(call('c1', 'method1'), 'other')).toThrow(/no other response/);
	});

	const sets = new JmapResult(
		{
			sessionState: 's',
			methodResponses: [
				[
					'Mailbox/set',
					{
						created: { k1: { id: 'M1' } },
						notCreated: { k2: { type: 'overQuota', description: 'full' } },
						notUpdated: { M3: { type: 'notFound' } },
						notDestroyed: { M4: { type: 'mailboxHasEmail' } },
					},
					'0',
				],
			],
		},
		redact,
	);
	const set = call('0', 'Mailbox/set');

	it('reads created ids and SetErrors', () => {
		expect(sets.created(set, 'k1')).toBe('M1');
		expect(() => sets.created(set, 'k2')).toThrow(
			expect.objectContaining({ code: 'overQuota', level: 'set', type: 'overQuota', target: 'k2' }),
		);
		expect(() => sets.created(set, 'k9')).toThrow(expect.objectContaining({ code: 'server' }));
		expect(setErrors(sets.get(set), 'notDestroyed')).toEqual([['M4', { type: 'mailboxHasEmail' }]]);
	});

	it('throws the first SetError that is not excused', () => {
		expect(() => sets.set(set)).toThrow(expect.objectContaining({ type: 'overQuota' }));
		expect(() => sets.set(set, (_type, key) => key === 'notCreated')).toThrow(
			expect.objectContaining({ type: 'notFound', target: 'M3' }),
		);
		expect(() => sets.set(set, (type) => type !== 'mailboxHasEmail')).toThrow(
			expect.objectContaining({ code: 'invalid', target: 'M4' }),
		);
		expect(() => sets.set(set, () => true)).not.toThrow();
	});
});

describe('patchPath', () => {
	it('escapes JSON Pointer tokens (RFC 6901)', () => {
		expect(patchPath('keywords', '$seen')).toBe('keywords/$seen');
		expect(patchPath('keywords', 'a/b~c')).toBe('keywords/a~1b~0c');
		expect(patchPath('mailboxIds', 'MB23cfa8094c0f41e6')).toBe('mailboxIds/MB23cfa8094c0f41e6');
	});
});
