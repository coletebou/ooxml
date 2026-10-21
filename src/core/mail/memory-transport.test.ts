import { createDemoSeed } from './demo-seed';
import { DEFAULT_MAILBOXES } from './memory-messages';
import { createMemoryTransport } from './memory-transport';
import { PartialUpdateError, type MailChange } from './transport';

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

	it('lists a message without its bodies, the parts of an html body included', async () => {
		const transport = createMemoryTransport();
		const raw = [
			'Subject: Parts',
			'Content-Type: multipart/mixed; boundary=b',
			'',
			'--b',
			'Content-Type: text/html',
			'',
			'<p>Hello<!--',
			'--b',
			'Content-Type: text/html',
			'',
			'<p>Bye</p>',
			'--b--',
			'',
		].join('\r\n');
		const { id } = await transport.importMessage(new TextEncoder().encode(raw), 'inbox');
		expect((await transport.message(id)).htmlParts).toHaveLength(2);
		const [summary] = await transport.summaries([id]);
		expect(summary?.subject).toBe('Parts');
		for (const body of ['text', 'html', 'htmlParts', 'attachments'])
			expect(summary, body).not.toHaveProperty(body);
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

	it('refuses to delete a folder that has folders inside it', async () => {
		const transport = createMemoryTransport();
		const parent = await transport.createMailbox({ name: 'Projects' });
		const child = await transport.createMailbox({ name: 'Q3', parentId: parent.id });
		await expect(transport.destroyMailbox(parent.id)).rejects.toMatchObject({ code: 'invalid' });
		const ids = (await transport.mailboxes()).map((mailbox) => mailbox.id);
		expect(ids).toEqual(expect.arrayContaining([parent.id, child.id]));
		await transport.destroyMailbox(child.id);
		await transport.destroyMailbox(parent.id);
		expect((await transport.mailboxes()).map((mailbox) => mailbox.id)).not.toContain(parent.id);
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

	it('changes every message it can, and names those it changed when not all', async () => {
		const transport = createMemoryTransport({
			messages: ['a', 'b', 'c'].map((id) => ({
				id,
				mailboxId: 'inbox',
				from: me,
				subject: id,
				receivedAt: 0,
			})),
		});
		const changes: MailChange[] = [];
		transport.watch((change) => changes.push(change));
		const archive = { mailboxIds: { inbox: false, archive: true } };
		// `gone` is no message, and `b` would be left in no folder: each is refused on its own.
		const error = await transport
			.update({ a: archive, gone: archive, b: { mailboxIds: { inbox: false } }, c: archive })
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(PartialUpdateError);
		expect(error).toMatchObject({ code: 'notFound', updated: ['a', 'c'] });
		const folders = async (id: string) => (await transport.message(id)).mailboxIds;
		expect([await folders('a'), await folders('b'), await folders('c')]).toEqual([
			['archive'],
			['inbox'],
			['archive'],
		]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(changes).toContainEqual({
			type: 'emails',
			created: [],
			updated: ['a', 'c'],
			destroyed: [],
		});
		// When it changed nothing, the failure is what it was.
		const none = await transport.update({ gone: archive }).catch((caught: unknown) => caught);
		expect(none).not.toBeInstanceOf(PartialUpdateError);
		expect(none).toMatchObject({ code: 'notFound' });
	});

	it('never hands out an id that a seed already uses', async () => {
		// Seeds named the way the transport numbers what it creates (`m1`, `d1`, `f1`, ...).
		const numbers = Array.from({ length: 12 }, (_, n) => (n + 1).toString(36));
		const seeded = numbers.flatMap((n) => [`m${n}`, `d${n}`]);
		const transport = createMemoryTransport({
			mailboxes: [...DEFAULT_MAILBOXES, ...numbers.map((n) => ({ id: `f${n}`, name: `f${n}` }))],
			messages: [
				{ mailboxId: 'inbox', from: me, subject: 'Without an id', receivedAt: 0 },
				...seeded.map((id, i) => ({
					id,
					mailboxId: id.startsWith('d') ? 'drafts' : 'inbox',
					from: me,
					subject: id,
					receivedAt: i + 1,
				})),
			],
		});
		const delivered = transport.deliver({
			mailboxId: 'inbox',
			from: me,
			subject: 'Delivered',
			receivedAt: 100,
		});
		const { id: draft } = await transport.saveDraft({
			to: [],
			cc: [],
			bcc: [],
			subject: 'Saved draft',
			text: '',
			attachments: [],
		});
		await transport.createMailbox({ name: 'Created folder' });
		expect((await transport.query({})).total).toBe(seeded.length + 3);
		expect(
			(await transport.summaries([...seeded, delivered, draft])).map((m) => m.subject),
		).toEqual([...seeded, 'Delivered', 'Saved draft']);
		expect(
			(await transport.mailboxes()).map((m) => m.name).slice(DEFAULT_MAILBOXES.length),
		).toEqual([...numbers.map((n) => `f${n}`), 'Created folder']);
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
