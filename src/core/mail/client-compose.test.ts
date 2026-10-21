import { createMailClient } from './client';
import type { FileInput, MailNotice } from './client-types';
import { createMemoryTransport } from './memory-transport';
import { DRAFT } from './model';
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

/** A memory server whose draft saves can fail or be held back, as its uploads and reads can. */
function setup() {
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
	const uploads = createGate();
	const reads = createGate();
	const control = { failure: null as MailTransportError | null, saves, uploads, reads };
	const transport: MailTransport = {
		...memory,
		async saveDraft(draft) {
			await saves.pass();
			if (control.failure) throw control.failure;
			return memory.saveDraft(draft);
		},
		async upload(bytes, type) {
			await uploads.pass();
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
		setTimeout: () => 0,
		clearTimeout: () => undefined,
	});
	client.onNotice((notice) => notices.push(notice));
	const drafts = async () => {
		const { ids } = await memory.query({ mailboxId: 'drafts' });
		return Promise.all(ids.filter((id) => id !== 'old').map((id) => memory.message(id)));
	};
	return { client, control, notices, drafts };
}

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

	it('keeps a file that finishes uploading after its window closed out of the next message', async () => {
		const { client, control } = setup();
		await until(client, (s) => s.status === 'ready');
		await client.compose('new');
		client.updateDraft({ subject: 'With a file' });
		control.uploads.holding = true;
		const attaching = client.attach([file('late.txt')]);
		await client.closeCompose();
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
