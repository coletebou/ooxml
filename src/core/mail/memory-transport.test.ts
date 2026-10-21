import { createDemoSeed } from './demo-seed';
import { createMemoryTransport } from './memory-transport';
import type { MailChange } from './transport';

const me = { name: 'You', email: 'you@example.com' };

describe('createMemoryTransport', () => {
	it('pages a query newest first and counts every match', async () => {
		const transport = createMemoryTransport({
			messages: Array.from({ length: 5 }, (_, i) => ({
				id: `m${i}`,
				mailboxId: 'inbox',
				from: me,
				subject: `S${i}`,
				receivedAt: i * 1000,
			})),
		});
		const page = await transport.query({ mailboxId: 'inbox' }, { position: 1, limit: 2 });
		expect(page).toEqual({ ids: ['m3', 'm2'], total: 5, position: 1 });
		const [first] = await transport.summaries(['m4', 'missing']);
		expect(first).not.toHaveProperty('text');
		expect((await transport.mailboxes()).find((m) => m.id === 'inbox')).toMatchObject({
			totalEmails: 5,
			unreadEmails: 0,
		});
	});

	it('keeps special-use folders and refuses to delete a folder that holds mail', async () => {
		const transport = createMemoryTransport({
			messages: [{ id: 'a', mailboxId: 'inbox', from: me, subject: 'x', receivedAt: 1 }],
		});
		await expect(transport.destroyMailbox('inbox')).rejects.toMatchObject({ code: 'forbidden' });
		const folder = await transport.createMailbox({ name: 'Projects' });
		await transport.update({ a: { mailboxIds: { [folder.id]: true, inbox: false } } });
		await expect(transport.destroyMailbox(folder.id)).rejects.toMatchObject({ code: 'invalid' });
		await expect(
			transport.update({ a: { mailboxIds: { [folder.id]: false } } }),
		).rejects.toMatchObject({
			code: 'invalid',
		});
	});

	it('delivers a message sent to yourself and pushes the changes', async () => {
		const transport = createMemoryTransport();
		const changes: MailChange[] = [];
		transport.watch((change) => changes.push(change));
		await transport.send({
			to: [me],
			cc: [],
			bcc: [],
			subject: 'Note to self',
			text: 'Hi',
			attachments: [],
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect((await transport.query({ mailboxId: 'inbox' })).total).toBe(1);
		expect((await transport.query({ mailboxId: 'sent' })).total).toBe(1);
		expect(changes.some((change) => change.type === 'emails' && change.created.length === 2)).toBe(
			true,
		);
		await expect(
			transport.send({ to: [], cc: [], bcc: [], subject: 'x', text: '', attachments: [] }),
		).rejects.toMatchObject({ code: 'invalid' });
	});

	it('serves the demo seed, thousands of messages included', async () => {
		const seed = createDemoSeed({ now: Date.UTC(2026, 9, 20, 12), bulk: 3000 });
		const transport = createMemoryTransport(seed);
		const inbox = await transport.query({ mailboxId: 'inbox' });
		expect(inbox.total).toBeGreaterThan(3000);
		expect(seed.contacts).toHaveLength(10);
		expect(seed.events.map((e) => e.title)).toContain('Stand-up');
		expect(createDemoSeed({ now: 1 }).messages).toEqual(createDemoSeed({ now: 1 }).messages);
	});

	it('dates every demo message in the past, the newsletter newest in the Inbox', async () => {
		const now = Date.UTC(2026, 9, 20, 12);
		const seed = createDemoSeed({ now, bulk: 200 });
		const messages = seed.messages ?? [];
		expect(messages.length).toBeGreaterThan(200);
		expect(messages.filter((m) => m.receivedAt > now).map((m) => m.id)).toEqual([]);
		const transport = createMemoryTransport(seed);
		const [newest] = await transport.summaries((await transport.query({ mailboxId: 'inbox' })).ids);
		expect(newest?.subject).toBe('This week: offline-first apps');
	});
});
