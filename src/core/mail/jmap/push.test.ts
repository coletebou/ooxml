import rfc from './__fixtures__/rfc8620-requests.json';
import type { MailChange } from '../transport';
import { eventSourceUrl, stateChangeFor } from './push';
import { createClock } from './test-support/clock';
import { json, rfcSession, until, type FakeServer } from './test-support/fake-server';
import { setup, TOKEN } from './test-support/setup';

const noChanges = (sinceState: unknown, newState = sinceState) => ({
	oldState: sinceState,
	newState,
	hasMoreChanges: false,
	created: [],
	updated: [],
	destroyed: [],
});

const stateEvent = (accountId: string, states: Record<string, string>): string =>
	`event: state\ndata: ${JSON.stringify({ '@type': 'StateChange', changed: { [accountId]: states } })}\n\n`;

const PING = 'event: ping\ndata: {"interval":60}\n\n';

const pushRequests = (server: FakeServer) =>
	server.requests.filter((request) => request.url.includes('/eventsource/'));

function pushed(options: { pollIntervalMs?: number } = {}) {
	const clock = createClock();
	const context = setup({ clock, push: 'auto', ...options });
	const { server } = context;
	server.on('Email/get', () => ({ state: 'E1', list: [] }));
	server.on('Mailbox/changes', (args) => noChanges(args.sinceState));
	server.on('Email/changes', (args) => ({ ...noChanges(args.sinceState, 'E2'), created: ['n1'] }));
	const changes: MailChange[] = [];
	return {
		...context,
		clock,
		changes,
		watch: () => context.transport.watch((change) => changes.push(change)),
	};
}

describe('eventSourceUrl and stateChangeFor', () => {
	it('fills the RFC 8620 2.1 template with every type, no closing and a 60 second ping', () => {
		const template = rfcSession().eventSourceUrl as string;
		expect(eventSourceUrl(template)).toBe(
			'https://jmap.example.com/eventsource/?types=*&closeafter=no&ping=60',
		);
	});

	it('picks the account out of the RFC 8620 7.1.1 StateChange', () => {
		const data = JSON.stringify(rfc.stateChange);
		expect(stateChangeFor(data, 'a3123')).toEqual({
			Email: 'd35ecb040aab',
			EmailDelivery: '428d565f2440',
			CalendarEvent: '87accfac587a',
		});
		expect(stateChangeFor(data, 'a43461d')).toEqual({
			Mailbox: '0af7a512ce70',
			CalendarEvent: '7a4297cecd76',
		});
		expect(stateChangeFor(data, 'other')).toBeNull();
		expect(stateChangeFor('{"@type":"Other"}', 'a3123')).toBeNull();
		expect(stateChangeFor('not json', 'a3123')).toBeNull();
	});
});

describe('push', () => {
	it('streams the event source with the credentials and syncs on state events for the account', async () => {
		const { server, clock, changes, watch } = pushed();
		const stop = watch();
		await until(() => server.streams.length === 1);
		const [stream] = server.streams;
		expect(stream!.url).toBe('https://jmap.example.com/eventsource/?types=*&closeafter=no&ping=60');
		expect(stream!.headers).toMatchObject({
			authorization: `Bearer ${TOKEN}`,
			accept: 'text/event-stream',
		});
		await until(() => server.calls().length === 2);
		expect(server.calls().map(([name]) => name)).toEqual(['Mailbox/get', 'Email/get']);
		stream!.send(stateEvent('A13824', { Email: 'E2', EmailDelivery: 'D2' }));
		await until(() => changes.length === 1);
		expect(server.argsOf('Email/changes')).toEqual([{ accountId: 'A13824', sinceState: 'E1' }]);
		expect(server.argsOf('Mailbox/changes')).toEqual([]);
		expect(changes).toEqual([{ type: 'emails', created: ['n1'], updated: [], destroyed: [] }]);
		stream!.send(stateEvent('A97813', { Email: 'E7' }));
		stream!.send(stateEvent('A13824', { Email: 'E2' }));
		await clock.advance(0);
		expect(server.argsOf('Email/changes')).toHaveLength(1);
		stop();
		expect(stream!.closed).toBe(true);
		expect(clock.waiting()).toEqual([]);
	});

	it('backs off, polls after repeated failures and stops polling once a stream works', async () => {
		const { server, clock, watch } = pushed({ pollIntervalMs: 30_000 });
		let refuse = true;
		server.route(
			(request) => refuse && request.url.includes('/eventsource/'),
			() => new Response('busy', { status: 503 }),
		);
		watch();
		await until(() => clock.waiting().length === 1);
		expect(clock.waiting()).toEqual([1_000]);
		await clock.advance(1_000);
		await until(() => pushRequests(server).length === 2 && clock.waiting().length === 1);
		expect(clock.waiting()).toEqual([2_000]);
		await clock.advance(2_000);
		await until(() => clock.waiting().length === 2);
		expect(clock.waiting()).toEqual([4_000, 30_000]);
		refuse = false;
		await clock.advance(4_000);
		await until(() => server.streams.length === 1);
		server.streams[0]!.send(PING);
		await until(() => clock.waiting().length === 1);
		expect(clock.waiting()).toEqual([130_000]);
	});

	it('polls for good when the event source is refused', async () => {
		const { server, clock, watch } = pushed();
		server.route(
			(request) => request.url.includes('/eventsource/'),
			() => json({ status: 404 }, 404),
		);
		watch();
		await until(() => clock.waiting().length === 1);
		expect(clock.waiting()).toEqual([60_000]);
		await clock.advance(60_000);
		await until(() => server.argsOf('Email/changes').length === 1);
		expect(pushRequests(server)).toHaveLength(1);
	});

	it('polls when the session has no event source', async () => {
		const { server, clock, watch } = pushed();
		server.session = rfcSession();
		delete server.session.eventSourceUrl;
		watch();
		await until(() => clock.waiting().length === 1);
		expect(clock.waiting()).toEqual([60_000]);
		expect(pushRequests(server)).toEqual([]);
	});

	it('drops a stream that stops pinging and reopens it with Last-Event-ID', async () => {
		const { server, clock, watch } = pushed();
		watch();
		await until(() => server.streams.length === 1);
		server.streams[0]!.send('id: 42\nevent: ping\ndata: {"interval":30}\n\n');
		await until(() => clock.waiting().includes(70_000));
		await clock.advance(70_000);
		await until(() => clock.waiting().includes(1_000));
		expect(server.streams[0]!.closed).toBe(true);
		await clock.advance(1_000);
		await until(() => server.streams.length === 2);
		expect(server.streams[1]!.headers['last-event-id']).toBe('42');
	});

	it('waits the retry time the server asks for after a stream that worked ends', async () => {
		const { server, clock, watch } = pushed();
		watch();
		await until(() => server.streams.length === 1);
		server.streams[0]!.send(`retry: 5000\n${PING}`);
		server.streams[0]!.end();
		await until(() => clock.waiting().includes(5_000));
		expect(clock.waiting()).toEqual([5_000]);
	});

	it('backs off from a server that closes every stream without a word', async () => {
		const { server, clock, watch } = pushed();
		watch();
		await until(() => server.streams.length === 1);
		server.streams[0]!.end();
		await until(() => clock.waiting().includes(1_000));
		expect(clock.waiting()).toEqual([1_000]);
		await clock.advance(1_000);
		await until(() => server.streams.length === 2);
		server.streams[1]!.end();
		await until(() => clock.waiting().includes(2_000));
		expect(clock.waiting()).toEqual([2_000]);
	});

	it('stops streaming and timing on close', async () => {
		const { server, clock, transport, watch } = pushed();
		watch();
		await until(() => server.streams.length === 1);
		server.streams[0]!.send(PING);
		await until(() => clock.waiting().length === 1);
		transport.close();
		expect(server.streams[0]!.closed).toBe(true);
		expect(clock.waiting()).toEqual([]);
		await clock.advance(600_000);
		expect(server.streams).toHaveLength(1);
	});
});
