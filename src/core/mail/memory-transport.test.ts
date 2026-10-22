import { createDemoSeed } from './demo-seed';
import { DEFAULT_MAILBOXES } from './memory-messages';
import { createMemoryTransport } from './memory-transport';
import { readEmail } from './mime';
import { PartialUpdateError, type MailChange } from './transport';

const me = { name: 'You', email: 'you@example.com' };
const ada = { name: 'Ada', email: 'ada@example.com' };

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

	it('keeps a saved draft whose old id is the one it would hand out next', async () => {
		// A draft whose copy is gone (deleted meanwhile, or from before a reload) still carries its
		// id; a fresh transport numbers its first draft `d1` too.
		const transport = createMemoryTransport();
		const draft = { to: [], cc: [], bcc: [], subject: 'Kept', text: 'Body', attachments: [] };
		const { id } = await transport.saveDraft({ ...draft, id: 'd1' });
		expect(id).not.toBe('d1');
		expect(await transport.message(id)).toMatchObject({ subject: 'Kept', text: 'Body' });
		expect((await transport.query({ mailboxId: 'drafts' })).ids).toEqual([id]);
		// The same for the copy a send files in Sent: its first is `s1`.
		const fresh = createMemoryTransport();
		const sent = await fresh.send({ ...draft, to: [me], id: 's1' });
		expect((await fresh.message(sent.id)).subject).toBe('Kept');
		expect((await fresh.query({ mailboxId: 'sent' })).ids).toEqual([sent.id]);
	});

	it('saves and sends a draft that has only HTML with the text of its HTML as its plain text', async () => {
		const transport = createMemoryTransport();
		const html = '<p>See you at <b>noon</b>.</p>';
		const draft = { to: [ada], cc: [], bcc: [], subject: 'Noon', text: '', html, attachments: [] };
		const { id } = await transport.saveDraft(draft);
		expect((await transport.message(id)).text).toBe('See you at noon.\n');
		const sent = await transport.message((await transport.send({ ...draft, id })).id);
		expect(sent).toMatchObject({ text: 'See you at noon.\n', html, preview: 'See you at noon.' });
		// Its .eml says the same in both alternatives.
		const raw = await transport.download(sent.blobId, { type: 'message/rfc822', name: 'noon.eml' });
		const parsed = readEmail(raw);
		expect(parsed.root.parts.map((part) => part.type)).toEqual(['text/plain', 'text/html']);
		expect([parsed.text, parsed.html]).toEqual(['See you at noon.\n', html]);
	});

	it('exports a message that has only HTML with the text of its HTML as its plain part', async () => {
		const html = '<p>Our <b>offer</b> ends Friday.</p>';
		const transport = createMemoryTransport({
			messages: [
				{ id: 'offer', mailboxId: 'inbox', from: ada, subject: 'Offer', html, receivedAt: 1 },
			],
		});
		const offer = await transport.message('offer');
		const raw = await transport.download(offer.blobId, {
			type: 'message/rfc822',
			name: 'offer.eml',
		});
		expect(readEmail(raw)).toMatchObject({ text: 'Our offer ends Friday.\n', html });
	});

	it('keeps a copy of its own of a file uploaded, and gives out copies of their own', async () => {
		const transport = createMemoryTransport();
		const read = async (blobId: string) =>
			transport.download(blobId, { type: 'text/plain', name: 'notes.txt' });
		// A small Buffer lies in memory Node shares between buffers, and `slice` of one is a view.
		const given = Buffer.from('original');
		const { blobId } = await transport.upload(given, 'text/plain');
		given.fill(0x78);
		const out = await read(blobId);
		expect(new TextDecoder().decode(out)).toBe('original');
		expect([out.constructor, out.byteOffset, out.buffer.byteLength]).toEqual([Uint8Array, 0, 8]);
		out.fill(0x79);
		expect(new TextDecoder().decode(await read(blobId))).toBe('original');
	});

	it('keeps a copy of its own of a message imported and of the parts of one delivered', async () => {
		const transport = createMemoryTransport();
		const text = 'Subject: Kept\r\n\r\nThe words\r\n';
		const eml = Buffer.from(text);
		const { id } = await transport.importMessage(eml, 'inbox');
		eml.fill(0x20);
		const { blobId } = await transport.message(id);
		const raw = await transport.download(blobId, { type: 'message/rfc822', name: 'kept.eml' });
		expect(new TextDecoder().decode(raw)).toBe(text);
		const part = Buffer.from('notes');
		const delivered = transport.deliver({
			mailboxId: 'inbox',
			from: me,
			subject: 'Notes',
			attachments: [{ name: 'notes.txt', type: 'text/plain', bytes: part }],
			receivedAt: 2,
		});
		part.fill(0x20);
		const [file] = (await transport.message(delivered)).attachments;
		const bytes = await transport.download(file!.blobId, { type: 'text/plain', name: 'notes.txt' });
		expect(new TextDecoder().decode(bytes)).toBe('notes');
	});

	it("writes the identity's Reply-To on a draft saved and on the Sent copy, as JMAP does", async () => {
		const desk = { name: 'Desk', email: 'desk@example.com' };
		const transport = createMemoryTransport({
			identities: [
				{ id: 'own', ...me, replyTo: [], bcc: [], textSignature: '', htmlSignature: '' },
				{ id: 'desk', ...me, replyTo: [desk], bcc: [], textSignature: '', htmlSignature: '' },
			],
		});
		const draft = {
			identityId: 'desk',
			to: [ada],
			cc: [],
			bcc: [],
			subject: 'Plans',
			text: 'Soon',
			attachments: [],
		};
		const { id } = await transport.saveDraft(draft);
		expect((await transport.message(id)).replyTo).toEqual([desk]);
		const { id: sent } = await transport.send({ ...draft, id });
		expect((await transport.message(sent)).replyTo).toEqual([desk]);
		const { id: plain } = await transport.saveDraft({ ...draft, identityId: 'own' });
		expect((await transport.message(plain)).replyTo).toEqual([]);
	});

	it('writes the Bcc of the Sent copy into its file, never into a copy delivered', async () => {
		const transport = createMemoryTransport();
		const draft = {
			to: [ada, me],
			cc: [],
			bcc: [{ name: 'Ben', email: 'ben@example.com' }],
			subject: 'Plans',
			text: 'Soon',
			attachments: [],
		};
		await transport.send(draft);
		const raw = async (mailboxId: string) => {
			const { ids } = await transport.query({ mailboxId });
			const message = await transport.message(ids[0]!);
			const name = 'plans.eml';
			return readEmail(await transport.download(message.blobId, { type: 'message/rfc822', name }));
		};
		expect((await raw('sent')).bcc).toEqual([{ name: 'Ben', email: 'ben@example.com' }]);
		// To yourself too: the copy that arrives is what a recipient gets, without the Bcc.
		expect((await raw('inbox')).bcc).toEqual([]);
	});

	it('keeps a copy of its own of the parts of a message imported, read as they were sent', async () => {
		const transport = createMemoryTransport();
		// An 8bit part is read as it was sent: its bytes are those of the message given.
		const eml = Buffer.from(
			[
				'Subject: Notes',
				'MIME-Version: 1.0',
				'Content-Type: multipart/mixed; boundary="b"',
				'',
				'--b',
				'Content-Type: text/plain',
				'',
				'See the notes.',
				'--b',
				'Content-Type: text/plain; name="notes.txt"',
				'Content-Disposition: attachment; filename="notes.txt"',
				'Content-Transfer-Encoding: 8bit',
				'',
				'The notes',
				'--b--',
				'',
			].join('\r\n'),
		);
		const { id } = await transport.importMessage(eml, 'inbox');
		eml.fill(0x20);
		const [file] = (await transport.message(id)).attachments;
		const bytes = await transport.download(file!.blobId, { type: 'text/plain', name: 'notes.txt' });
		expect(new TextDecoder().decode(bytes)).toBe('The notes');
	});

	it('sends a message to yourself where there is no Inbox once, into Sent', async () => {
		const transport = createMemoryTransport({
			mailboxes: DEFAULT_MAILBOXES.filter((mailbox) => mailbox.role !== 'inbox'),
		});
		const draft = { to: [me], cc: [], bcc: [], subject: 'Note', text: 'Hi', attachments: [] };
		const { id } = await transport.saveDraft(draft);
		await transport.send({ ...draft, id });
		expect((await transport.query({ mailboxId: 'sent' })).total).toBe(1);
		expect((await transport.query({ mailboxId: 'drafts' })).total).toBe(0);
		expect((await transport.query({})).total).toBe(1);
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

describe('createMemoryTransport refuses what a server would', () => {
	const draft = (blobId: string) => ({
		to: [ada],
		cc: [],
		bcc: [],
		subject: 'With a file',
		text: '',
		attachments: [{ blobId, name: 'a.txt', type: 'text/plain', size: 5 }],
	});

	it('saves or sends no draft whose file was never uploaded', async () => {
		const transport = createMemoryTransport({});
		for (const write of [
			() => transport.saveDraft(draft('nope')),
			() => transport.send(draft('nope')),
		])
			await expect(write()).rejects.toMatchObject({ code: 'notFound' });
		expect(
			(await transport.query({ mailboxId: 'drafts' }, { position: 0, limit: 10 })).ids,
		).toEqual([]);
		expect((await transport.query({ mailboxId: 'sent' }, { position: 0, limit: 10 })).ids).toEqual(
			[],
		);
		// Uploaded first, the same draft is saved and sent.
		const { blobId } = await transport.upload(new Uint8Array(5), 'text/plain');
		await expect(transport.saveDraft(draft(blobId))).resolves.toMatchObject({
			id: expect.any(String),
		});
		await expect(transport.send(draft(blobId))).resolves.toMatchObject({ id: expect.any(String) });
	});

	it('delivers no message under an id another holds, and seeds none twice', async () => {
		const transport = createMemoryTransport({
			messages: [{ id: 'a', mailboxId: 'inbox', from: me, subject: 'Original', receivedAt: 1 }],
		});
		expect(() =>
			transport.deliver({ id: 'a', mailboxId: 'archive', from: me, subject: 'New', receivedAt: 2 }),
		).toThrow(expect.objectContaining({ code: 'invalid' }));
		expect(await transport.message('a')).toMatchObject({
			subject: 'Original',
			mailboxIds: ['inbox'],
		});
		const twice = { id: 'b', mailboxId: 'inbox', from: me, subject: 'Twice', receivedAt: 1 };
		expect(() => createMemoryTransport({ messages: [twice, twice] })).toThrow(
			expect.objectContaining({ code: 'invalid' }),
		);
	});
});
