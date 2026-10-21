// `Email/set` and `EmailSubmission/set` on the fake server, over a small store of messages, so the
// draft and send tests can check where messages end up. Creation ids (`#draft`) are resolved the
// way RFC 8620 5.3 says, within the request and across it.
import { isRecord, type JmapInvocation } from '../types';
import type { FakeServer } from './fake-server';

export interface StoredEmail {
	mailboxIds: Record<string, true>;
	keywords: Record<string, true>;
	create?: Record<string, unknown>;
}

export interface MailStore {
	emails: Map<string, StoredEmail>;
	submissions: Record<string, unknown>[];
	/** A SetError type to refuse the next creations with. */
	refuseCreate: string | null;
	refuseSubmission: string | null;
	/** Leave out the implicit `Email/set` response of `onSuccessUpdateEmail`. */
	skipImplicit: boolean;
}

function applyPatch(email: StoredEmail, patch: Record<string, unknown>): void {
	for (const [path, value] of Object.entries(patch)) {
		const [property, key] = path.split('/') as ['mailboxIds' | 'keywords', string];
		const name = key.replace(/~1/g, '/').replace(/~0/g, '~');
		if (value === true) email[property][name] = true;
		else delete email[property][name];
	}
}

export function installMailStore(server: FakeServer): MailStore {
	const store: MailStore = {
		emails: new Map([
			['old-draft', { mailboxIds: { drafts: true }, keywords: { $draft: true, $seen: true } }],
			['original', { mailboxIds: { MBinbox: true }, keywords: { $seen: true } }],
		]),
		submissions: [],
		refuseCreate: null,
		refuseSubmission: null,
		skipImplicit: false,
	};
	const created = new Map<string, string>();
	let next = 0;
	const real = (id: string): string | undefined =>
		id.startsWith('#') ? created.get(id.slice(1)) : id;

	server.on('Email/set', (args, call) => {
		// Creation ids live for one request; the transport's first call of a request is "0".
		if (call.id === '0') created.clear();
		const out: Record<string, Record<string, unknown> | string[]> = {};
		for (const [creationId, object] of Object.entries(isRecord(args.create) ? args.create : {})) {
			if (store.refuseCreate) {
				out.notCreated = { ...out.notCreated, [creationId]: { type: store.refuseCreate } };
				continue;
			}
			const id = `E${++next}`;
			const record = object as Record<string, unknown>;
			store.emails.set(id, {
				mailboxIds: { ...(record.mailboxIds as Record<string, true>) },
				keywords: { ...(record.keywords as Record<string, true>) },
				create: record,
			});
			created.set(creationId, id);
			out.created = {
				...out.created,
				[creationId]: { id, blobId: `B${id}`, threadId: `T${id}`, size: 100 },
			};
		}
		for (const [id, patch] of Object.entries(isRecord(args.update) ? args.update : {})) {
			const email = store.emails.get(real(id) ?? '');
			if (!email) out.notUpdated = { ...out.notUpdated, [id]: { type: 'notFound' } };
			else {
				applyPatch(email, patch as Record<string, unknown>);
				out.updated = { ...out.updated, [id]: null };
			}
		}
		for (const id of Array.isArray(args.destroy) ? (args.destroy as string[]) : []) {
			if (store.emails.delete(id)) out.destroyed = [...((out.destroyed as string[]) ?? []), id];
			else out.notDestroyed = { ...out.notDestroyed, [id]: { type: 'notFound' } };
		}
		return out;
	});

	server.on('EmailSubmission/set', (args, call) => {
		const [creationId, submission] = Object.entries(
			args.create as Record<string, Record<string, unknown>>,
		)[0]!;
		const emailId = real(String(submission.emailId));
		if (store.refuseSubmission || !emailId)
			return {
				notCreated: { [creationId]: { type: store.refuseSubmission ?? 'invalidProperties' } },
			};
		store.submissions.push({ ...submission, emailId });
		const responses: JmapInvocation[] = [
			[
				'EmailSubmission/set',
				{ created: { [creationId]: { id: 'ES-1', undoStatus: 'final' } } },
				call.id,
			],
		];
		const onSuccess = isRecord(args.onSuccessUpdateEmail)
			? args.onSuccessUpdateEmail[`#${creationId}`]
			: undefined;
		if (isRecord(onSuccess) && !store.skipImplicit) {
			applyPatch(store.emails.get(emailId)!, onSuccess);
			responses.push(['Email/set', { updated: { [emailId]: null } }, call.id]);
		}
		return responses;
	});
	return store;
}
