// Answering, forwarding and sending over JMAP, from the client down to the requests it makes: the
// From of a wildcard identity, the whole of a message the reading pane shows cut short, the inline
// picture a forward carries with its Content-ID, and a send the server did not confirm.
import { createMailClient } from '../client';
import { until } from './test-support/fake-server';
import { installMailStore } from './test-support/mail-store';
import { IDENTITIES, setup } from './test-support/setup';

const TEXT = 'How much is the larger model, delivered by Friday?';
const HTML = '<p>How much?</p><p><img src="cid:logo@example.org" alt="Logo"></p>';

/** The message to answer, as `Email/get` returns it: its text cut short whenever a limit is set. */
function original(args: Record<string, unknown>): Record<string, unknown> {
	return {
		id: 'original',
		blobId: 'Boriginal',
		threadId: 'Toriginal',
		mailboxIds: { MBinbox: true },
		keywords: { $seen: true },
		receivedAt: '2026-01-05T09:00:00Z',
		messageId: ['q1@example.org'],
		from: [{ name: 'Ada', email: 'ada@example.org' }],
		to: [{ name: 'Sales', email: 'sales@example.com' }],
		subject: 'Prices',
		textBody: [{ partId: '1', type: 'text/plain' }],
		htmlBody: [{ partId: '2', type: 'text/html' }],
		attachments: [
			{
				partId: '3',
				blobId: 'Glogo',
				type: 'image/png',
				name: 'logo.png',
				size: 4,
				disposition: 'inline',
				cid: 'logo@example.org',
			},
		],
		bodyValues: {
			'1': args.maxBodyValueBytes
				? { value: TEXT.slice(0, 8), isTruncated: true }
				: { value: TEXT, isTruncated: false },
			'2': { value: HTML, isTruncated: false },
		},
	};
}

/** A client over the fake server holding `original`, answering as `identities`. */
async function connected(identities: readonly unknown[] = IDENTITIES) {
	const { server, transport } = setup();
	const store = installMailStore(server);
	server.on('Identity/get', () => ({ state: 'I1', list: identities, notFound: [] }));
	server.on('Email/query', () => ({ ids: ['original'], position: 0, total: 1 }));
	server.on('Email/get', (args) => ({ state: 'E1', list: [original(args)] }));
	const client = createMailClient({ transport });
	await until(() => client.getState().conversations.length === 1);
	/** The Email the client created last, as it asked for it. */
	const created = (): Record<string, unknown> => [...store.emails.values()].at(-1)!.create!;
	return { client, store, created };
}

describe('answering and forwarding over JMAP', () => {
	it('answers from the address a wildcard identity was written to, quoting the whole text', async () => {
		const wildcard = IDENTITIES[1] as { id: string; email: string };
		expect(wildcard.email).toBe('*@example.com');
		const { client, store, created } = await connected([wildcard]);
		await client.open('original');
		expect(client.getState().open?.messages[0]?.message).toMatchObject({ truncated: true });
		expect(await client.compose('reply', 'original')).toBe(true);
		expect(await client.send()).toBe(true);
		expect(created()).toMatchObject({
			from: [{ name: 'Joe B', email: 'sales@example.com' }],
			to: [{ name: 'Ada', email: 'ada@example.org' }],
		});
		const values = created().bodyValues as Record<string, { value: string }>;
		expect(values.text!.value).toContain(`> ${TEXT}`);
		expect(store.submissions).toEqual([{ identityId: wildcard.id, emailId: 'E1' }]);
		client.destroy();
	});

	it('forwards the inline picture the copied HTML shows, with its Content-ID', async () => {
		const { client, created } = await connected();
		expect(await client.compose('forward', 'original')).toBe(true);
		client.updateDraft({ to: [{ name: 'Ben', email: 'ben@example.org' }] });
		expect(await client.send()).toBe(true);
		const values = created().bodyValues as Record<string, { value: string }>;
		expect(values.html!.value).toContain(HTML);
		expect(created().attachments).toEqual([
			{
				blobId: 'Glogo',
				type: 'image/png',
				name: 'logo.png',
				disposition: 'inline',
				cid: 'logo@example.org',
			},
		]);
		client.destroy();
	});
});

describe('sending over JMAP', () => {
	it('saves a new message whose send went unconfirmed, and sent again asks about it', async () => {
		for (const failed of ['before', 'after'] as const) {
			const due = new Map<number, () => void>();
			let next = 0;
			const { server, transport } = setup();
			const store = installMailStore(server);
			const client = createMailClient({
				transport,
				setTimeout: (callback) => (due.set(++next, callback), next),
				clearTimeout: (handle) => void due.delete(handle as number),
			});
			await until(() => client.getState().status === 'ready');
			await client.compose('new');
			// Sent within the quiet moment after the last edit, before any save.
			client.updateDraft({ to: [{ name: 'Ada', email: 'ada@example.org' }], subject: 'Hello' });
			store.failSubmission = failed;
			expect(await client.send()).toBe(false);
			store.failSubmission = null;
			const submitted = store.submissions.length;
			// Saved after a quiet moment, so a reload keeps it, and still said to be unconfirmed.
			for (const callback of due.values()) callback();
			due.clear();
			await until(() => client.getState().compose?.draft.id !== undefined);
			expect(client.getState().compose, failed).toMatchObject({
				status: 'error',
				error: 'uncertain',
			});
			// Sent again unchanged, the server is asked first: the message goes out once in all.
			expect(await client.send(), failed).toBe(true);
			expect(store.submissions, failed).toHaveLength(failed === 'after' ? submitted : 1);
			client.destroy();
		}
	});
});
