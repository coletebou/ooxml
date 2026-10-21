// A JMAP transport over the fake server, with the folders and identities most tests need.
import submission from '../__fixtures__/rfc8621-submission.json';
import { createJmapTransport, type JmapTransportOptions } from '../transport';
import type { JmapAuth } from '../http';
import type { FakeClock } from './clock';
import { createFakeServer, type FakeServer } from './fake-server';

export const TOKEN = 'tok-SECRET-1';
export const AUTH: JmapAuth = { type: 'bearer', token: TOKEN };

/** Drafts and Sent use the ids of the RFC 8621 7.5.1 example. */
export const DRAFTS = '7cb4e8ee-df87-4757-b9c4-2ea1ca41b38e';
export const SENT = '73dbcb4b-bffc-48bd-8c2a-a2e91ca672f6';

export const MAILBOXES = [
	{
		id: 'MBinbox',
		name: 'Inbox',
		parentId: null,
		role: 'inbox',
		sortOrder: 1,
		totalEmails: 3,
		unreadEmails: 1,
	},
	{
		id: DRAFTS,
		name: 'Drafts',
		parentId: null,
		role: 'drafts',
		sortOrder: 2,
		totalEmails: 0,
		unreadEmails: 0,
	},
	{
		id: SENT,
		name: 'Sent',
		parentId: null,
		role: 'sent',
		sortOrder: 3,
		totalEmails: 0,
		unreadEmails: 0,
	},
	{
		id: 'MBall',
		name: 'All Mail',
		parentId: null,
		role: 'all',
		sortOrder: 4,
		totalEmails: 3,
		unreadEmails: 1,
	},
	{
		id: 'MBwork',
		name: 'Work',
		parentId: null,
		role: null,
		sortOrder: 5,
		totalEmails: 0,
		unreadEmails: 0,
	},
];

export const IDENTITIES = (submission.identityResponse[1] as { list: unknown[] }).list;

export interface Setup {
	server: FakeServer;
	transport: ReturnType<typeof createJmapTransport>;
}

export function setup(
	options: { server?: FakeServer; clock?: FakeClock } & Partial<JmapTransportOptions> = {},
): Setup {
	const { server: given, clock, ...rest } = options;
	const server = given ?? createFakeServer();
	server.on('Mailbox/get', (args) => ({
		accountId: args.accountId,
		state: 'M1',
		list: Array.isArray(args.ids)
			? MAILBOXES.filter((mailbox) => (args.ids as string[]).includes(mailbox.id))
			: MAILBOXES,
		notFound: [],
	}));
	server.on('Identity/get', (args) => ({
		accountId: args.accountId,
		state: 'I1',
		list: IDENTITIES,
		notFound: [],
	}));
	const transport = createJmapTransport({
		url: 'https://jmap.example.com',
		auth: AUTH,
		fetch: server.fetch,
		push: 'off',
		...(clock ? { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout } : {}),
		...rest,
	});
	return { server, transport };
}

/** The failure `promise` ends with. */
export async function failure(promise: Promise<unknown>): Promise<Error & { code?: string }> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof Error) return error;
		throw error;
	}
	throw new Error('expected a failure');
}
