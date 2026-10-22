// `Email/set`, `Email/get`, `Email/query` (by Message-ID), `EmailSubmission/set`,
// `EmailSubmission/query` and `EmailSubmission/get` on the fake server, over a small store of
// messages, so the draft and send tests can check where messages end up. Creation ids (`#draft`)
// are resolved the way RFC 8620 5.3 says, within the request and across it.
import { isRecord, type JmapInvocation } from '../types';
import type { FakeServer } from './fake-server';

export interface StoredEmail {
	mailboxIds: Record<string, true>;
	keywords: Record<string, true>;
	/** The object it was created from; its `messageId` is what a `header` search finds it by. */
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
	/**
	 * The SetError type to refuse an update with (`notUpdated`), the implicit one of
	 * `onSuccessUpdateEmail` included, or null to apply it; the destroys likewise (`notDestroyed`).
	 */
	refuseUpdate: ((id: string, patch: Record<string, unknown>) => string | null) | null;
	refuseDestroy: ((id: string) => string | null) | null;
	/**
	 * Answer a submission with `serverPartialFail` (RFC 8620 3.6.2), `before` recording it or
	 * `after`, as a server that sent the message and failed then.
	 */
	failSubmission: 'before' | 'after' | null;
	/** False: `Email/query` refuses a `header` condition (`unsupportedFilter`, RFC 8620 5.5). */
	headerSearch: boolean;
	/**
	 * The `undoStatus` of each submission by id (`ES-1`, ...), `final` unless set here: a test sets
	 * `canceled` for one another client undid (RFC 8621 7).
	 */
	undoStatus: Record<string, 'pending' | 'final' | 'canceled'>;
}

/**
 * True when `email` meets the `header` condition of `filter` (RFC 8621 4.4.1), for `Message-ID`
 * only, whose value a creation gave it; every email meets a filter without one.
 */
function matches(email: StoredEmail, filter: Record<string, unknown>): boolean {
	if (!Array.isArray(filter.header)) return true;
	const [name, text] = filter.header as unknown[];
	const ids = email.create?.messageId;
	return (
		String(name).toLowerCase() === 'message-id' &&
		Array.isArray(ids) &&
		(text === undefined || ids.some((id) => String(id).includes(String(text))))
	);
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
		refuseUpdate: null,
		refuseDestroy: null,
		failSubmission: null,
		headerSearch: true,
		undoStatus: {},
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
			const refused = email && store.refuseUpdate?.(id, patch as Record<string, unknown>);
			if (!email) out.notUpdated = { ...out.notUpdated, [id]: { type: 'notFound' } };
			else if (refused) out.notUpdated = { ...out.notUpdated, [id]: { type: refused } };
			else {
				applyPatch(email, patch as Record<string, unknown>);
				out.updated = { ...out.updated, [id]: null };
			}
		}
		for (const id of Array.isArray(args.destroy) ? (args.destroy as string[]) : []) {
			const refused = store.emails.has(id) && store.refuseDestroy?.(id);
			if (refused) out.notDestroyed = { ...out.notDestroyed, [id]: { type: refused } };
			else if (store.emails.delete(id))
				out.destroyed = [...((out.destroyed as string[]) ?? []), id];
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
		const failed: JmapInvocation[] = [['error', { type: 'serverPartialFail' }, call.id]];
		if (store.failSubmission === 'before') return failed;
		store.submissions.push({ ...submission, emailId });
		if (store.failSubmission === 'after') return failed;
		const id = `ES-${store.submissions.length}`;
		const responses: JmapInvocation[] = [
			['EmailSubmission/set', { created: { [creationId]: { id, undoStatus: 'final' } } }, call.id],
		];
		const onSuccess = isRecord(args.onSuccessUpdateEmail)
			? args.onSuccessUpdateEmail[`#${creationId}`]
			: undefined;
		if (isRecord(onSuccess) && !store.skipImplicit) {
			const refused = store.refuseUpdate?.(emailId, onSuccess);
			if (refused)
				responses.push(['Email/set', { notUpdated: { [emailId]: { type: refused } } }, call.id]);
			else {
				applyPatch(store.emails.get(emailId)!, onSuccess);
				responses.push(['Email/set', { updated: { [emailId]: null } }, call.id]);
			}
		}
		return responses;
	});

	server.on('EmailSubmission/query', (args) => {
		const filter = isRecord(args.filter) ? args.filter : {};
		const emailIds = Array.isArray(filter.emailIds) ? filter.emailIds : null;
		const ids = store.submissions
			.map((submission, index) => [submission.emailId, `ES-${index + 1}`] as const)
			.filter(([emailId]) => !emailIds || emailIds.includes(emailId))
			.map(([, id]) => id);
		return { ids, position: 0, total: ids.length };
	});

	server.on('EmailSubmission/get', (args) => {
		const ids = Array.isArray(args.ids) ? (args.ids as string[]) : [];
		const known = (id: string): boolean =>
			/^ES-\d+$/.test(id) && Number(id.slice(3)) <= store.submissions.length;
		return {
			list: ids.filter(known).map((id) => ({ id, undoStatus: store.undoStatus[id] ?? 'final' })),
			notFound: ids.filter((id) => !known(id)),
		};
	});

	server.on('Email/get', (args) => {
		const ids = Array.isArray(args.ids) ? (args.ids as string[]) : [];
		return {
			list: ids.flatMap((id) => {
				const email = store.emails.get(id);
				return email ? [{ id, mailboxIds: email.mailboxIds, keywords: email.keywords }] : [];
			}),
			notFound: ids.filter((id) => !store.emails.has(id)),
		};
	});

	server.on('Email/query', (args, call) => {
		const filter = isRecord(args.filter) ? args.filter : {};
		if (filter.header !== undefined && !store.headerSearch)
			return [['error', { type: 'unsupportedFilter' }, call.id]];
		const ids = [...store.emails].filter(([, email]) => matches(email, filter)).map(([id]) => id);
		return { ids, position: 0, total: ids.length };
	});
	return store;
}
