import email from './__fixtures__/rfc8621-email.json';
import mailbox from './__fixtures__/rfc8621-mailbox.json';
import type { MailChange } from '../transport';
import { MAX_CHANGE_PAGES } from './changes';
import { createClock } from './test-support/clock';
import { until } from './test-support/fake-server';
import { MAILBOXES, setup } from './test-support/setup';
import type { JmapInvocation } from './types';

const payload = (invocation: unknown): Record<string, unknown> => (invocation as JmapInvocation)[1];
const noChanges = (sinceState: unknown, newState = sinceState) => ({
	oldState: sinceState,
	newState,
	hasMoreChanges: false,
	created: [],
	updated: [],
	destroyed: [],
});
const names = (calls: JmapInvocation[]) => calls.map(([name]) => name);

function polled() {
	const clock = createClock();
	const context = setup({ clock, push: 'poll' });
	const { server } = context;
	const state = { email: 'E1' };
	server.on('Email/get', () => ({ state: state.email, list: [], notFound: [] }));
	server.on('Mailbox/changes', (args) => noChanges(args.sinceState));
	server.on('Email/changes', (args) => noChanges(args.sinceState));
	const changes: MailChange[] = [];
	const stop = context.transport.watch((change) => changes.push(change));
	return { ...context, clock, state, changes, stop };
}

describe('watch with polling', () => {
	it('takes the states first, then asks Mailbox/changes and Email/changes every interval', async () => {
		const { server, clock, changes, stop } = polled();
		await until(() => server.calls().length === 2);
		expect(server.calls()).toEqual([
			['Mailbox/get', { accountId: 'A13824', ids: [] }, '0'],
			['Email/get', { accountId: 'A13824', ids: [] }, '1'],
		]);
		server.on('Email/changes', () => payload(email.changes.response));
		await clock.advance(60_000);
		await until(() => changes.length === 1);
		expect(names(server.calls().slice(2))).toEqual(['Mailbox/changes', 'Email/changes']);
		expect(server.argsOf('Email/changes')[0]).toEqual({ accountId: 'A13824', sinceState: 'E1' });
		expect(changes).toEqual([
			{
				type: 'emails',
				created: ['Me8de6c9f6de198239b982ea2'],
				updated: ['Ma783e5cdf5f2deffbc97930a'],
				destroyed: ['M9bd17497e2a99cb345fc1d0a'],
			},
		]);
		server.on('Email/changes', (args) => noChanges(args.sinceState));
		await clock.advance(60_000);
		await until(() => server.argsOf('Email/changes').length === 2);
		expect(server.argsOf('Email/changes')[1]).toEqual({
			accountId: 'A13824',
			sinceState: '780800',
		});
		expect(changes).toHaveLength(1);
		stop();
		expect(clock.waiting()).toEqual([]);
		await clock.advance(120_000);
		expect(server.argsOf('Email/changes')).toHaveLength(2);
	});

	it('reports mailbox changes, such as the RFC 8621 2.6 count update', async () => {
		const { server, clock, changes } = polled();
		await until(() => server.calls().length === 2);
		server.on('Mailbox/changes', () => payload((mailbox.changesResponse as unknown[])[0]));
		await clock.advance(60_000);
		await until(() => changes.length === 1);
		expect(changes).toEqual([{ type: 'mailboxes' }]);
	});

	it('follows hasMoreChanges and reports the pages as one change', async () => {
		const { server, clock, changes } = polled();
		await until(() => server.calls().length === 2);
		server.on('Email/changes', (args) =>
			args.sinceState === 'E1'
				? { ...noChanges('E1', 'E2'), hasMoreChanges: true, created: ['a'], destroyed: ['b'] }
				: { ...noChanges('E2', 'E3'), created: ['c'], updated: ['a', 'd'], destroyed: ['c'] },
		);
		await clock.advance(60_000);
		await until(() => changes.length === 1);
		expect(server.argsOf('Email/changes').map((args) => args.sinceState)).toEqual(['E1', 'E2']);
		expect(changes).toEqual([
			{ type: 'emails', created: ['a'], updated: ['d'], destroyed: ['b', 'c'] },
		]);
	});

	it('resets when the server cannot calculate the changes, then starts from the current state', async () => {
		const { server, clock, changes, state } = polled();
		await until(() => server.calls().length === 2);
		server.on('Email/changes', (_args, call) => [
			['error', { type: 'cannotCalculateChanges' }, call.id],
		]);
		state.email = 'E9';
		await clock.advance(60_000);
		await until(() => changes.length === 1);
		expect(changes).toEqual([{ type: 'reset' }]);
		expect(names(server.calls().slice(-1))).toEqual(['Email/get']);
		server.on('Email/changes', (args) => noChanges(args.sinceState));
		await clock.advance(60_000);
		await until(() => server.argsOf('Email/changes').length === 2);
		expect(server.argsOf('Email/changes').at(-1)).toEqual({
			accountId: 'A13824',
			sinceState: 'E9',
		});
	});

	it('reloads only the mailboxes when their changes cannot be calculated', async () => {
		const { server, clock, changes } = polled();
		await until(() => server.calls().length === 2);
		server.on('Mailbox/changes', (_args, call) => [
			['error', { type: 'cannotCalculateChanges' }, call.id],
		]);
		await clock.advance(60_000);
		await until(() => changes.length === 1);
		expect(changes).toEqual([{ type: 'mailboxes' }]);
	});

	it('gives up with a reset after too many pages', async () => {
		const { server, clock, changes } = polled();
		await until(() => server.calls().length === 2);
		let page = 0;
		server.on('Email/changes', (args) => ({
			...noChanges(args.sinceState, `P${++page}`),
			hasMoreChanges: true,
			updated: [`m${page}`],
		}));
		await clock.advance(60_000);
		await until(() => changes.length === 1);
		expect(server.argsOf('Email/changes')).toHaveLength(MAX_CHANGE_PAGES);
		expect(changes).toEqual([{ type: 'reset' }]);
	});

	it('keeps polling after a failed poll', async () => {
		const { server, clock, changes } = polled();
		await until(() => server.calls().length === 2);
		server.route(
			(request) => request.method === 'POST' && (request.body ?? '').includes('Email/changes'),
			() => new Response('oops', { status: 500 }),
		);
		await clock.advance(60_000);
		await until(() => clock.waiting().length === 1);
		expect(changes).toEqual([]);
		expect(clock.waiting()).toEqual([60_000]);
	});
});

describe('watch without push or polling', () => {
	it('still notices a newer state in a response and fetches what changed', async () => {
		const clock = createClock();
		const { server, transport } = setup({ clock, push: 'off' });
		const state = { email: 'E1' };
		server.on('Email/get', (args) => ({
			state: state.email,
			list: (args.ids as string[]).map((id) => ({ id })),
		}));
		server.on('Email/changes', (args) => ({ ...noChanges(args.sinceState, 'E2'), updated: ['x'] }));
		const changes: MailChange[] = [];
		transport.watch((change) => changes.push(change));
		await transport.summaries(['x']);
		expect(clock.waiting()).toEqual([]);
		expect(changes).toEqual([]);
		state.email = 'E2';
		await transport.summaries(['x']);
		await until(() => changes.length > 0);
		expect(server.argsOf('Email/changes')).toEqual([{ accountId: 'A13824', sinceState: 'E1' }]);
		expect(changes).toEqual([{ type: 'emails', created: [], updated: ['x'], destroyed: [] }]);
	});

	it('looks for changes after its own updates, as the memory transport reports them', async () => {
		const { server, transport } = setup({ push: 'off' });
		server.on('Email/get', () => ({ state: 'E1', list: [] }));
		server.on('Email/set', () => ({ updated: { x: null } }));
		server.on('Mailbox/changes', (args) => noChanges(args.sinceState));
		server.on('Email/changes', (args) => ({ ...noChanges(args.sinceState, 'E2'), updated: ['x'] }));
		const changes: MailChange[] = [];
		transport.watch((change) => changes.push(change));
		await transport.summaries(['x']);
		await transport.mailboxes();
		await transport.update({ x: { keywords: { $seen: true } } });
		await until(() => changes.length > 0);
		expect(changes).toEqual([{ type: 'emails', created: [], updated: ['x'], destroyed: [] }]);
		expect(server.argsOf('Mailbox/changes')).toEqual([{ accountId: 'A13824', sinceState: 'M1' }]);
	});

	/** A server whose writes move the states on, watched before anything was read. */
	function unread() {
		const context = setup({ push: 'off' });
		const { server } = context;
		const state = { mailbox: 'M1', email: 'E1' };
		server.on('Mailbox/get', (args) => ({
			state: state.mailbox,
			list: MAILBOXES.filter((item) => !Array.isArray(args.ids) || args.ids.includes(item.id)),
		}));
		server.on('Email/get', () => ({ state: state.email, list: [] }));
		server.on('Mailbox/set', () => {
			state.mailbox = 'M2';
			return { oldState: 'M1', newState: 'M2', created: { mailbox: { id: 'MBnew' } } };
		});
		server.on('Email/set', () => {
			state.email = 'E2';
			return { oldState: 'E1', newState: 'E2', created: { draft: { id: 'E9' } } };
		});
		// What changed is what the writes did: nothing while a state is still the first one.
		server.on('Mailbox/changes', (args) =>
			args.sinceState === 'M1' && state.mailbox === 'M2'
				? { ...noChanges('M1', 'M2'), created: ['MBnew'] }
				: noChanges(args.sinceState),
		);
		server.on('Email/changes', (args) =>
			args.sinceState === 'E1' && state.email === 'E2'
				? { ...noChanges('E1', 'E2'), created: ['E9'] }
				: noChanges(args.sinceState),
		);
		const changes: MailChange[] = [];
		context.transport.watch((change) => changes.push(change));
		return { ...context, changes };
	}

	it('reports its own first change when no state was known before it', async () => {
		// The write is the first the tracker hears of the type: its response says what came before.
		const folder = unread();
		await folder.transport.createMailbox({ name: 'Projects' });
		await until(() => folder.changes.length > 0);
		expect(folder.changes).toEqual([{ type: 'mailboxes' }]);
		expect(folder.server.argsOf('Mailbox/changes')).toEqual([
			{ accountId: 'A13824', sinceState: 'M1' },
		]);

		const draft = unread();
		await draft.transport.saveDraft({
			to: [],
			cc: [],
			bcc: [],
			subject: 'Plan',
			text: 'Notes',
			attachments: [],
			inReplyTo: [],
			references: [],
		});
		await until(() => draft.changes.length > 0);
		expect(draft.changes).toEqual([
			{ type: 'emails', created: ['E9'], updated: [], destroyed: [] },
		]);
		expect(draft.server.argsOf('Email/changes')).toEqual([
			{ accountId: 'A13824', sinceState: 'E1' },
		]);
	});

	it('tells every listener and stops when the last one leaves', async () => {
		const { server, transport } = setup({ push: 'off' });
		const state = { email: 'E1' };
		server.on('Email/get', () => ({ state: state.email, list: [] }));
		server.on('Email/changes', (args) => ({ ...noChanges(args.sinceState, 'E2'), created: ['n'] }));
		const first: MailChange[] = [];
		const second: MailChange[] = [];
		const leaveFirst = transport.watch((change) => first.push(change));
		const leaveSecond = transport.watch((change) => second.push(change));
		await transport.summaries(['n']);
		state.email = 'E2';
		await transport.summaries(['n']);
		await until(() => first.length > 0 && second.length > 0);
		expect(first).toEqual(second);
		leaveFirst();
		leaveSecond();
		leaveSecond();
		state.email = 'E3';
		await transport.summaries(['n']);
		await new Promise((resolve) => setImmediate(resolve));
		expect(server.argsOf('Email/changes')).toHaveLength(1);
	});
});
