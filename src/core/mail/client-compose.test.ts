import { createMailClient } from './client';
import type { FileInput, MailNotice } from './client-types';
import { createMemoryTransport, type MemoryTransportOptions } from './memory-transport';
import { DRAFT, type Identity, type MailMessage } from './model';
import { createGate, until } from './test-support/client';
import { MailTransportError, type MailTransport } from './transport';

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);
const me = { name: 'You', email: 'you@example.com' };
const ada = { name: 'Ada', email: 'ada@example.com' };
const file = (name: string): FileInput => ({
	name,
	type: 'text/plain',
	bytes: new TextEncoder().encode(name),
});

/** Timers a test runs by hand (`fire`), the cancelled ones never. */
function manualTimers() {
	const due = new Map<number, () => void>();
	let next = 0;
	return {
		setTimeout: (callback: () => void): number => {
			due.set(++next, callback);
			return next;
		},
		clearTimeout: (handle: unknown): void => {
			due.delete(handle as number);
		},
		fire: (): void => {
			const callbacks = [...due.values()];
			due.clear();
			for (const callback of callbacks) callback();
		},
	};
}

/**
 * A memory server whose saves, sends and uploads can fail or be held back, as its reads can. The
 * autosave timer fires only when `timers` fires it.
 */
function setup(timers?: ReturnType<typeof manualTimers>) {
	const memory = createMemoryTransport({
		now: () => T0,
		messages: [
			{
				id: 'old',
				mailboxId: 'drafts',
				from: me,
				subject: 'Older draft',
				text: 'Saved before',
				receivedAt: T0,
				keywords: [DRAFT],
			},
			{ id: 'hello', mailboxId: 'inbox', from: ada, to: [me], subject: 'Hello', receivedAt: T0 },
		],
	});
	const saves = createGate();
	const sends = createGate();
	const uploads = createGate();
	const reads = createGate();
	const control = {
		failure: null as MailTransportError | null,
		sendFailure: null as MailTransportError | null,
		uploadFailure: null as MailTransportError | null,
		saves,
		sends,
		uploads,
		reads,
	};
	const transport: MailTransport = {
		...memory,
		async saveDraft(draft) {
			await saves.pass();
			if (control.failure) throw control.failure;
			return memory.saveDraft(draft);
		},
		async send(draft) {
			await sends.pass();
			if (control.sendFailure) throw control.sendFailure;
			return memory.send(draft);
		},
		async upload(bytes, type) {
			await uploads.pass();
			if (control.uploadFailure) throw control.uploadFailure;
			return memory.upload(bytes, type);
		},
		async message(id) {
			await reads.pass();
			return memory.message(id);
		},
	};
	const notices: MailNotice[] = [];
	// The autosave timer never fires on its own: each test saves or closes when it means to.
	const client = createMailClient({
		transport,
		now: () => T0,
		setTimeout: timers?.setTimeout ?? (() => 0),
		clearTimeout: timers?.clearTimeout ?? (() => undefined),
	});
	client.onNotice((notice) => notices.push(notice));
	const drafts = async () => {
		const { ids } = await memory.query({ mailboxId: 'drafts' });
		return Promise.all(ids.filter((id) => id !== 'old').map((id) => memory.message(id)));
	};
	const sent = async () => {
		const { ids } = await memory.query({ mailboxId: 'sent' });
		return Promise.all(ids.map((id) => memory.message(id)));
	};
	return { client, control, notices, drafts, sent, memory };
}

/** A client over a plain memory server, its autosave timer never firing on its own. */
function plain(options: MemoryTransportOptions) {
	const memory = createMemoryTransport({ now: () => T0, ...options });
	const notices: MailNotice[] = [];
	const client = createMailClient({
		transport: memory,
		now: () => T0,
		setTimeout: () => 0,
		clearTimeout: () => undefined,
	});
	client.onNotice((notice) => notices.push(notice));
	const inMailbox = async (mailboxId: string) => {
		const { ids } = await memory.query({ mailboxId });
		return Promise.all(ids.map((id) => memory.message(id)));
	};
	return { client, memory, notices, inMailbox };
}

const identityOf = (id: string, name: string, email: string): Identity => ({
	id,
	name,
	email,
	replyTo: [],
	bcc: [],
	textSignature: '',
	htmlSignature: '',
});

describe('the compose window', () => {
	it('stays open with the edits when its draft cannot be saved, and closes once it is', async () => {
		const { client, control, notices, drafts } = setup();
		await until(client, (s) => s.status === 'ready');
		await client.compose('new');
		client.updateDraft({ subject: 'Offline', text: 'The only copy' });
		control.failure = new MailTransportError('network', 'Offline.');
		const closed = await client.closeCompose();
		expect(client.getState().compose).toMatchObject({
			status: 'error',
			error: 'network',
			draft: { subject: 'Offline', text: 'The only copy' },
		});
		expect(closed).toBe(false);
		expect(notices).toContainEqual({ kind: 'error', action: 'save', code: 'network' });
		control.failure = null;
		expect(await client.closeCompose()).toBe(true);
		expect(client.getState().compose).toBeNull();
		expect((await drafts()).map((draft) => draft.text)).toEqual(['The only copy']);
		client.destroy();
	});

	it('is not replaced by another message or draft while its own cannot be saved', async () => {
		const { client, control, notices } = setup();
		await until(client, (s) => s.status === 'ready');
		await client.compose('new');
		client.updateDraft({ subject: 'Mine', text: 'Not saved yet' });
		const { session } = client.getState().compose!;
		control.failure = new MailTransportError('overQuota', 'Full.');
		const opened = [await client.compose('new'), await client.editDraft('old')];
		expect(client.getState().compose).toMatchObject({
			session,
			status: 'error',
			error: 'overQuota',
			draft: { subject: 'Mine', text: 'Not saved yet' },
		});
		expect(opened).toEqual([false, false]);
		expect(notices.filter((notice) => notice.kind === 'error')).toEqual([
			{ kind: 'error', action: 'save', code: 'overQuota' },
			{ kind: 'error', action: 'save', code: 'overQuota' },
		]);
		control.failure = null;
		expect(await client.editDraft('old')).toBe(true);
		expect(client.getState().compose?.draft).toMatchObject({ id: 'old', text: 'Saved before' });
		client.destroy();
	});

	it('stays open when the message to answer cannot be read', async () => {
		const { client, notices } = setup();
		await until(client, (s) => s.status === 'ready');
		await client.compose('new');
		client.updateDraft({ text: 'Typing' });
		const { session } = client.getState().compose!;
		expect(await client.compose('reply', 'missing')).toBe(false);
		expect(notices).toEqual([{ kind: 'error', action: 'open', code: 'notFound' }]);
		expect(client.getState().compose).toMatchObject({ session, draft: { text: 'Typing' } });
		client.destroy();
	});

	it('saves a message started while an answer was loading before the answer opens', async () => {
		const { client, control, drafts } = setup();
		await until(client, (s) => s.status === 'ready');
		control.reads.holding = true;
		const answering = client.compose('reply', 'hello');
		await client.compose('new');
		client.updateDraft({ subject: 'Started meanwhile' });
		control.reads.release();
		expect(await answering).toBe(true);
		expect(client.getState().compose).toMatchObject({
			mode: 'reply',
			draft: { subject: 'Re: Hello' },
		});
		expect((await drafts()).map((draft) => draft.subject)).toEqual(['Started meanwhile']);
		client.destroy();
	});

	it('keeps the open draft, edits and all, when asked to edit that draft again', async () => {
		const { client, drafts } = setup();
		await until(client, (s) => s.status === 'ready');
		expect(await client.editDraft('old')).toBe(true);
		client.updateDraft({ text: 'Edited' });
		const { session } = client.getState().compose!;
		expect(await client.editDraft('old')).toBe(true);
		expect(client.getState().compose).toMatchObject({
			session,
			draft: { id: 'old', text: 'Edited' },
		});
		expect(await drafts()).toEqual([]);
		client.destroy();
	});

	it('marks as saved only what the server saved, not edits made while it was saving', async () => {
		const { client, control, drafts } = setup();
		await until(client, (s) => s.status === 'ready');
		await client.compose('new');
		client.updateDraft({ subject: 'First' });
		control.saves.holding = true;
		const saving = client.saveDraft();
		client.updateDraft({ subject: 'Second' });
		control.saves.release();
		await saving;
		expect(client.getState().compose).toMatchObject({ status: 'editing' });
		expect(await client.closeCompose()).toBe(true);
		expect((await drafts()).map((draft) => draft.subject)).toEqual(['Second']);
		client.destroy();
	});

	it('saves a file attached to a saved draft when the window closes at once', async () => {
		const { client, drafts } = setup();
		await until(client, (s) => s.status === 'ready');
		await client.compose('new');
		client.updateDraft({ subject: 'Report' });
		await client.saveDraft();
		expect(client.getState().compose?.status).toBe('saved');
		await client.attach([file('notes.txt')]);
		expect(client.getState().compose?.status).toBe('editing');
		expect(await client.closeCompose()).toBe(true);
		const [saved] = await drafts();
		expect(saved?.attachments.map((attachment) => attachment.name)).toEqual(['notes.txt']);
		client.destroy();
	});

	it('stays open while a file uploads, then saves the file with its draft', async () => {
		const { client, control, drafts } = setup();
		await until(client, (s) => s.status === 'ready');
		await client.compose('new');
		client.updateDraft({ subject: 'With a file' });
		const { session } = client.getState().compose!;
		control.uploads.holding = true;
		const attaching = client.attach([file('late.txt')]);
		// Closing now, or giving way to another message, would save the draft without the file.
		expect(await client.closeCompose()).toBe(false);
		expect(await client.compose('new')).toBe(false);
		expect(client.getState().compose).toMatchObject({
			session,
			uploading: 1,
			draft: { subject: 'With a file', attachments: [] },
		});
		control.uploads.release();
		await attaching;
		expect(await client.closeCompose()).toBe(true);
		const [saved, ...others] = await drafts();
		expect(others).toEqual([]);
		expect(saved?.subject).toBe('With a file');
		expect(saved?.attachments.map((attachment) => attachment.name)).toEqual(['late.txt']);
		client.destroy();
	});

	it('says why it stays open while a file uploads, once for each action it refuses', async () => {
		const { client, control, notices } = setup();
		await until(client, (s) => s.status === 'ready');
		await client.compose('new');
		control.uploads.holding = true;
		const attaching = client.attach([file('late.txt'), file('later.txt')]);
		const refused = [
			await client.compose('new'),
			await client.compose('reply', 'hello'),
			await client.editDraft('old'),
			await client.closeCompose(),
		];
		expect(refused).toEqual([false, false, false, false]);
		const stillUploading: MailNotice = { kind: 'warning', action: 'upload', uploading: 2 };
		expect(notices).toEqual(Array.from({ length: 4 }, () => stillUploading));
		control.uploads.release();
		await attaching;
		// Once the files are in, the window closes, and nothing more is said.
		expect(await client.closeCompose()).toBe(true);
		expect(notices).toHaveLength(4);
		client.destroy();
	});

	it('closes once a failed upload is over, without the file', async () => {
		const { client, control, notices, drafts } = setup();
		await until(client, (s) => s.status === 'ready');
		await client.compose('new');
		client.updateDraft({ subject: 'No file' });
		control.uploads.holding = true;
		control.uploadFailure = new MailTransportError('tooLarge', 'Too large.');
		const attaching = client.attach([file('huge.bin')]);
		expect(await client.closeCompose()).toBe(false);
		control.uploads.release();
		await attaching;
		expect(notices).toContainEqual({ kind: 'error', action: 'upload', code: 'tooLarge' });
		expect(await client.closeCompose()).toBe(true);
		const [saved] = await drafts();
		expect(saved).toMatchObject({ subject: 'No file', attachments: [] });
		client.destroy();
	});

	it('does not send while a file uploads, then sends the file with the message', async () => {
		const { client, control, sent } = setup();
		await until(client, (s) => s.status === 'ready');
		await client.compose('new');
		client.updateDraft({ to: [ada], subject: 'With a file' });
		control.uploads.holding = true;
		const attaching = client.attach([file('late.txt')]);
		// Sending now would send the message without the file, which then has nowhere to go.
		expect(await client.send()).toBe(false);
		expect(client.getState().compose).toMatchObject({
			status: 'editing',
			error: null,
			uploading: 1,
			draft: { subject: 'With a file', attachments: [] },
		});
		expect(await sent()).toEqual([]);
		control.uploads.release();
		await attaching;
		expect(await client.send()).toBe(true);
		const [message, ...others] = await sent();
		expect(others).toEqual([]);
		expect(message?.attachments.map((attachment) => attachment.name)).toEqual(['late.txt']);
		client.destroy();
	});

	it('does not send a file added while the last save finished without it', async () => {
		const { client, control, sent } = setup();
		await until(client, (s) => s.status === 'ready');
		await client.compose('new');
		client.updateDraft({ to: [ada], subject: 'Racing' });
		control.saves.holding = true;
		const saving = client.saveDraft();
		const sending = client.send();
		control.uploads.holding = true;
		const attaching = client.attach([file('late.txt')]);
		control.saves.release();
		await saving;
		expect(await sending).toBe(false);
		expect(await sent()).toEqual([]);
		control.uploads.release();
		await attaching;
		expect(await client.send()).toBe(true);
		const [message] = await sent();
		expect(message?.attachments.map((attachment) => attachment.name)).toEqual(['late.txt']);
		client.destroy();
	});

	it('says why it does not send while a file uploads, once each time it is asked', async () => {
		const { client, control, notices, sent } = setup();
		await until(client, (s) => s.status === 'ready');
		await client.compose('new');
		client.updateDraft({ to: [ada], subject: 'Two files' });
		const stillUploading: MailNotice = { kind: 'warning', action: 'upload', uploading: 1 };
		// Asked while a file uploads (Ctrl+Enter: the button is off meanwhile).
		control.uploads.holding = true;
		const first = client.attach([file('one.txt')]);
		expect(await client.send()).toBe(false);
		expect(notices).toEqual([stillUploading]);
		control.uploads.release();
		await first;
		// Asked while the draft saves, and a file added before that save is over.
		control.saves.holding = true;
		const saving = client.saveDraft();
		const sending = client.send();
		control.uploads.holding = true;
		const second = client.attach([file('two.txt')]);
		control.saves.release();
		await saving;
		expect(await sending).toBe(false);
		expect(notices).toEqual([stillUploading, stillUploading]);
		control.uploads.release();
		await second;
		expect(await client.send()).toBe(true);
		expect(notices.slice(2)).toEqual([{ kind: 'done', action: 'sent', count: 1 }]);
		const [message] = await sent();
		expect(message?.attachments.map((attachment) => attachment.name)).toEqual([
			'one.txt',
			'two.txt',
		]);
		client.destroy();
	});

	it('gives way to another message only once the one on its way is sent', async () => {
		const { client, control, sent } = setup();
		await until(client, (s) => s.status === 'ready');
		await client.compose('new');
		client.updateDraft({ to: [ada], subject: 'On its way' });
		await client.saveDraft();
		const { session } = client.getState().compose!;
		control.sends.holding = true;
		const sending = client.send();
		const opening = client.compose('new');
		await new Promise((resolve) => setTimeout(resolve, 5));
		// Nothing takes the place of a window whose message is on its way.
		expect(client.getState().compose).toMatchObject({ session, status: 'sending' });
		control.sends.release();
		expect(await sending).toBe(true);
		expect(await opening).toBe(true);
		client.updateDraft({ subject: 'Next', text: 'Not saved yet' });
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(client.getState().compose).toMatchObject({
			status: 'editing',
			draft: { subject: 'Next', text: 'Not saved yet' },
		});
		expect((await sent()).map((message) => message.subject)).toEqual(['On its way']);
		client.destroy();
	});

	it('sends once when Send is pressed twice while its draft saves', async () => {
		const { client, control, sent } = setup();
		await until(client, (s) => s.status === 'ready');
		await client.compose('new');
		client.updateDraft({ to: [ada], subject: 'Once' });
		control.saves.holding = true;
		const saving = client.saveDraft();
		const first = client.send();
		const second = client.send();
		control.saves.release();
		await saving;
		expect([await first, await second]).toEqual([true, false]);
		expect((await sent()).map((message) => message.subject)).toEqual(['Once']);
		client.destroy();
	});

	it('keeps a message on its way sending while it is edited, and the edits when it fails', async () => {
		const { client, control, notices, drafts, sent } = setup();
		await until(client, (s) => s.status === 'ready');
		await client.compose('new');
		client.updateDraft({ to: [ada], subject: 'Offline', text: 'First words' });
		await client.saveDraft();
		const [saved] = await drafts();
		control.sends.holding = true;
		control.sendFailure = new MailTransportError('network', 'Offline.');
		const sending = client.send();
		client.updateDraft({ text: 'First words, and more' });
		// Still on its way: Send stays off, nothing saves over it, Discard and Close wait.
		expect(client.getState().compose).toMatchObject({ status: 'sending' });
		expect(await client.send()).toBe(false);
		await client.saveDraft();
		await client.discardDraft();
		const closing = client.closeCompose();
		expect(client.getState().compose?.draft.text).toBe('First words, and more');
		expect((await drafts()).map((draft) => draft.id)).toEqual([saved!.id]);
		control.sends.release();
		expect([await sending, await closing]).toEqual([false, false]);
		expect(client.getState().compose).toMatchObject({
			status: 'error',
			error: 'network',
			draft: { text: 'First words, and more' },
		});
		expect(notices).toContainEqual({ kind: 'error', action: 'send', code: 'network' });
		expect(await sent()).toEqual([]);
		// Closed now, it saves the edit made while it was on its way.
		expect(await client.closeCompose()).toBe(true);
		expect((await drafts()).map((draft) => draft.text)).toEqual(['First words, and more']);
		client.destroy();
	});

	it('saves what was typed just before Send once the send fails', async () => {
		const timers = manualTimers();
		const { client, control, drafts } = setup(timers);
		await until(client, (s) => s.status === 'ready');
		await client.compose('new');
		// Sent within the quiet moment after the last edit: the save waiting for it is called off.
		client.updateDraft({ to: [ada], subject: 'Offline', text: 'Typed just now' });
		control.sendFailure = new MailTransportError('network', 'Offline.');
		expect(await client.send()).toBe(false);
		expect(client.getState().compose).toMatchObject({ status: 'error', error: 'network' });
		// The edits the server does not hold are saved after a quiet moment again.
		timers.fire();
		await until(client, (s) => s.compose?.status === 'saved');
		expect((await drafts()).map((draft) => draft.text)).toEqual(['Typed just now']);
		client.destroy();
	});

	it('saves nothing over a message that may have gone out, so sent again it is asked about', async () => {
		const timers = manualTimers();
		const { client, control, drafts } = setup(timers);
		await until(client, (s) => s.status === 'ready');
		await client.compose('new');
		client.updateDraft({ to: [ada], subject: 'Perhaps', text: 'Sent or not' });
		control.sendFailure = new MailTransportError('uncertain', 'Not confirmed.');
		expect(await client.send()).toBe(false);
		// Saved, the draft would be a new message, which a second Send could not ask about.
		timers.fire();
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(client.getState().compose).toMatchObject({
			status: 'error',
			error: 'uncertain',
			draft: { text: 'Sent or not' },
		});
		expect(client.getState().compose?.draft.id).toBeUndefined();
		expect(await drafts()).toEqual([]);
		client.destroy();
	});

	it('saves a draft that holds only formatted text', async () => {
		const { client, drafts } = setup();
		await until(client, (s) => s.status === 'ready');
		await client.compose('new');
		client.updateDraft({ html: '<p>Notes</p>' });
		expect(await client.closeCompose()).toBe(true);
		expect((await drafts()).map((draft) => draft.html)).toEqual(['<p>Notes</p>']);
		client.destroy();
	});

	it('reopens a draft the server saved under the same id with what it saved', async () => {
		const memory = createMemoryTransport({
			now: () => T0,
			messages: [
				{
					id: 'old',
					mailboxId: 'drafts',
					from: me,
					subject: 'Older draft',
					text: 'Saved before',
					receivedAt: T0,
					keywords: [DRAFT],
				},
			],
		});
		const saved = new Map<string, MailMessage>();
		const transport: MailTransport = {
			...memory,
			// Saved in place, the id kept, as the transport contract allows.
			async saveDraft(draft) {
				if (!draft.id) return memory.saveDraft(draft);
				const before = await transport.message(draft.id);
				saved.set(draft.id, { ...before, subject: draft.subject, text: draft.text });
				return { id: draft.id };
			},
			message: async (id) => saved.get(id) ?? memory.message(id),
		};
		const client = createMailClient({
			transport,
			now: () => T0,
			setTimeout: () => 0,
			clearTimeout: () => undefined,
		});
		await until(client, (s) => s.status === 'ready');
		expect(await client.editDraft('old')).toBe(true);
		client.updateDraft({ text: 'Newer' });
		expect(await client.closeCompose()).toBe(true);
		expect(await client.editDraft('old')).toBe(true);
		expect(client.getState().compose?.draft).toMatchObject({ id: 'old', text: 'Newer' });
		client.destroy();
	});

	it('saves a saved draft emptied of everything, so reopening it shows it empty', async () => {
		const { client, drafts, memory } = setup();
		await until(client, (s) => s.status === 'ready');
		expect(await client.editDraft('old')).toBe(true);
		await client.attach([file('notes.txt')]);
		await client.saveDraft();
		expect((await drafts()).map((draft) => draft.attachments.length)).toEqual([1]);
		// Everything taken out again, the file too.
		const [notes] = client.getState().compose!.draft.attachments;
		client.detach(notes!.blobId);
		client.updateDraft({ subject: '', text: '' });
		expect(await client.closeCompose()).toBe(true);
		const kept = await drafts();
		expect(kept.map((draft) => [draft.subject, draft.text, draft.attachments.length])).toEqual([
			['', '', 0],
		]);
		await expect(memory.message('old')).rejects.toMatchObject({ code: 'notFound' });
		expect(await client.editDraft(kept[0]!.id)).toBe(true);
		expect(client.getState().compose?.draft).toMatchObject({
			subject: '',
			text: '',
			attachments: [],
		});
		client.destroy();
	});

	it('forwards an inline image with its message, and keeps it inline through a saved draft', async () => {
		const logo = new Uint8Array([137, 80, 78, 71]);
		const { client, memory, inMailbox } = plain({
			messages: [
				{
					id: 'welcome',
					mailboxId: 'inbox',
					from: ada,
					to: [me],
					subject: 'Welcome',
					html: '<p>Our logo:</p><p><img src="cid:logo@example.test" alt="Logo"></p>',
					attachments: [
						{
							name: 'logo.png',
							type: 'image/png',
							bytes: logo,
							cid: 'logo@example.test',
							inline: true,
						},
					],
					receivedAt: T0,
				},
			],
		});
		await until(client, (s) => s.status === 'ready');
		expect(await client.compose('forward', 'welcome')).toBe(true);
		client.updateDraft({ to: [{ name: 'Ben', email: 'ben@example.com' }] });
		expect(await client.closeCompose()).toBe(true);
		const [saved] = await inMailbox('drafts');
		expect(saved?.attachments).toMatchObject([{ disposition: 'inline', cid: 'logo@example.test' }]);
		expect(await client.editDraft(saved!.id)).toBe(true);
		expect(client.getState().compose?.draft.attachments).toMatchObject([
			{ name: 'logo.png', cid: 'logo@example.test', inline: true },
		]);
		expect(await client.send()).toBe(true);
		const [sent] = await inMailbox('sent');
		expect(sent?.html).toContain('<img src="cid:logo@example.test" alt="Logo">');
		expect(sent?.attachments).toMatchObject([
			{ name: 'logo.png', disposition: 'inline', cid: 'logo@example.test' },
		]);
		expect(sent?.hasAttachment).toBe(false);
		const raw = new TextDecoder().decode(
			await memory.download(sent!.blobId, { type: 'message/rfc822', name: 'sent.eml' }),
		);
		expect(raw).toContain('Content-Type: multipart/related');
		expect(raw).toContain('Content-ID: <logo@example.test>');
		client.destroy();
	});

	it('starts answers, forwards and reopened drafts with what its draftHtml makes of a message', async () => {
		const part = (name: string, cid?: string) => ({
			name,
			type: cid ? 'image/png' : 'text/plain',
			bytes: new TextEncoder().encode(name),
			...(cid ? { cid, inline: true } : {}),
		});
		const memory = createMemoryTransport({
			now: () => T0,
			messages: [
				{
					id: 'welcome',
					mailboxId: 'inbox',
					from: ada,
					to: [me],
					subject: 'Welcome',
					html: '<p><img src="cid:logo@example.test"></p>',
					attachments: [part('logo.png', 'logo@example.test')],
					receivedAt: T0,
				},
				{
					id: 'saved',
					mailboxId: 'drafts',
					from: me,
					to: [ada],
					subject: 'Saved',
					html: '<p>Draft</p>',
					attachments: [part('notes.txt')],
					receivedAt: T0,
					keywords: [DRAFT],
				},
			],
		});
		const calls: [string, string[]][] = [];
		const client = createMailClient({
			transport: memory,
			now: () => T0,
			setTimeout: () => 0,
			clearTimeout: () => undefined,
			draftHtml: (message, parts) => {
				calls.push([message.id, parts.map((p) => p.name)]);
				return `<p>Clean ${message.id}</p>`;
			},
		});
		await until(client, (s) => s.status === 'ready');
		const html = () => client.getState().compose?.draft.html;
		expect(await client.compose('forward', 'welcome')).toBe(true);
		expect(html()).toMatch(/<br><p>Clean welcome<\/p>$/);
		await client.discardDraft();
		expect(await client.compose('reply', 'welcome')).toBe(true);
		expect(html()).toMatch(/<blockquote type="cite"><p>Clean welcome<\/p><\/blockquote>$/);
		await client.discardDraft();
		expect(await client.editDraft('saved')).toBe(true);
		expect(html()).toBe('<p>Clean saved</p>');
		// A forward and a reopened draft are given their own parts; an answer, none.
		expect(calls).toEqual([
			['welcome', ['logo.png']],
			['welcome', []],
			['saved', ['notes.txt']],
		]);
		client.destroy();
	});

	it('answers from the address a wildcard identity covers, and reopens the draft as it', async () => {
		const desk = { name: 'Sales desk', email: 'desk@example.net' };
		const { client, inMailbox } = plain({
			identities: [
				identityOf('own', 'You', me.email),
				identityOf('desk', 'Sales', '*@example.net'),
			],
			messages: [
				{ id: 'ask', mailboxId: 'inbox', from: ada, to: [desk], subject: 'Prices', receivedAt: T0 },
			],
		});
		await until(client, (s) => s.status === 'ready');
		expect(await client.compose('reply', 'ask')).toBe(true);
		const answer = { identityId: 'desk', from: { name: 'Sales', email: 'desk@example.net' } };
		expect(client.getState().compose?.draft).toMatchObject(answer);
		expect(await client.closeCompose()).toBe(true);
		const [saved] = await inMailbox('drafts');
		expect(saved?.from).toEqual([{ name: 'Sales', email: 'desk@example.net' }]);
		expect(await client.editDraft(saved!.id)).toBe(true);
		expect(client.getState().compose?.draft).toMatchObject(answer);
		client.destroy();
	});

	it('answers a message sent from an address a wildcard identity covers as that address', async () => {
		const sales = { name: 'Sales', email: 'sales@example.net' };
		const { client } = plain({
			identities: [
				identityOf('own', 'You', me.email),
				identityOf('desk', 'Sales', '*@example.net'),
			],
			messages: [
				{
					id: 'quote',
					mailboxId: 'sent',
					from: sales,
					to: [ada],
					subject: 'Quote',
					receivedAt: T0,
				},
			],
		});
		await until(client, (s) => s.status === 'ready');
		expect(await client.compose('reply', 'quote')).toBe(true);
		// The person's own message: answered as it was sent, to whom it was sent.
		expect(client.getState().compose?.draft).toMatchObject({
			identityId: 'desk',
			from: sales,
			to: [ada],
		});
		client.destroy();
	});

	it('answers a received message from an address a wildcard identity covers as received', async () => {
		const alice = { name: 'Alice', email: 'alice@example.net' };
		const list = { name: 'Team', email: 'list@other.org' };
		const { client } = plain({
			identities: [identityOf('desk', 'Sales', '*@example.net')],
			messages: [
				{
					id: 'post',
					mailboxId: 'inbox',
					from: alice,
					to: [list],
					subject: 'Plan',
					receivedAt: T0,
				},
			],
		});
		await until(client, (s) => s.status === 'ready');
		expect(await client.compose('reply', 'post')).toBe(true);
		// A colleague's message, not the person's own: never written as them, and answered to them.
		const draft = client.getState().compose?.draft;
		expect(draft).toMatchObject({ identityId: 'desk', to: [alice] });
		expect(draft).not.toHaveProperty('from');
		client.destroy();
	});

	it('sends a reopened draft saved with only HTML with a plain text made from it', async () => {
		const { client, inMailbox } = plain({
			messages: [
				{
					id: 'rich',
					mailboxId: 'drafts',
					from: me,
					to: [ada],
					subject: 'Rich only',
					html: '<div>Hello Ada,</div><div>see you at <b>noon</b>.</div>',
					receivedAt: T0,
					keywords: [DRAFT],
				},
			],
		});
		await until(client, (s) => s.status === 'ready');
		expect(await client.editDraft('rich')).toBe(true);
		expect(await client.send()).toBe(true);
		const [sent] = await inMailbox('sent');
		expect(sent?.text?.split('\n').filter(Boolean)).toEqual(['Hello Ada,', 'see you at noon.']);
		client.destroy();
	});

	it('quotes the whole of a message the reading pane shows cut short, or does not answer', async () => {
		const memory = createMemoryTransport({
			now: () => T0,
			messages: ['long', 'longer'].map((id) => ({
				id,
				mailboxId: 'inbox',
				from: ada,
				to: [me],
				subject: id,
				text: 'The start. And all the rest of it.',
				receivedAt: T0,
			})),
		});
		/** Cuts every body to its first sentence unless asked for it whole; `longer` never comes whole. */
		const transport: MailTransport = {
			...memory,
			async message(id, options) {
				const message = await memory.message(id);
				if (!options?.whole) return { ...message, text: 'The start.', truncated: true };
				if (id === 'longer') throw new MailTransportError('tooLarge', 'Only part of it.');
				return message;
			},
		};
		const notices: MailNotice[] = [];
		const client = createMailClient({
			transport,
			now: () => T0,
			setTimeout: () => 0,
			clearTimeout: () => undefined,
		});
		client.onNotice((notice) => notices.push(notice));
		await until(client, (s) => s.status === 'ready' && s.conversations.length === 2);
		await client.open('long');
		expect(client.getState().open?.messages[0]?.message).toMatchObject({
			text: 'The start.',
			truncated: true,
		});
		expect(await client.compose('reply', 'long')).toBe(true);
		expect(client.getState().compose?.draft.text).toContain('> The start. And all the rest of it.');
		await client.discardDraft();
		await client.open('longer');
		expect(await client.compose('forward', 'longer')).toBe(false);
		expect(client.getState().compose).toBeNull();
		expect(notices).toContainEqual({ kind: 'error', action: 'open', code: 'tooLarge' });
		client.destroy();
	});

	it('keeps a file that finishes uploading after its draft was discarded out of the next message', async () => {
		const { client, control } = setup();
		await until(client, (s) => s.status === 'ready');
		await client.compose('new');
		client.updateDraft({ subject: 'With a file' });
		control.uploads.holding = true;
		const attaching = client.attach([file('late.txt')]);
		await client.discardDraft();
		await client.compose('new');
		const { session } = client.getState().compose!;
		control.uploads.release();
		await attaching;
		expect(client.getState().compose).toMatchObject({
			session,
			uploading: 0,
			draft: { attachments: [] },
		});
		client.destroy();
	});
});
