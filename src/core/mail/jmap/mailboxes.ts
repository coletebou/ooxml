// Mailboxes over JMAP (RFC 8621 2): `Mailbox/get` for the folder list, `Mailbox/set` to create,
// rename and destroy folders, and the role-to-id map drafts and sends use to find Drafts and Sent.
// New code.
import type { Mailbox, MailboxRole } from '../model';
import { MailTransportError, type NewMailbox } from '../transport';
import type { ChangeTracker } from './changes';
import type { JmapClient } from './client';
import { objects, strings, toMailbox, type JmapObject } from './convert';

const PROPERTIES = ['name', 'parentId', 'role', 'sortOrder', 'totalEmails', 'unreadEmails'];

export interface MailboxMethods {
	mailboxes(): Promise<Mailbox[]>;
	createMailbox(input: NewMailbox): Promise<Mailbox>;
	renameMailbox(id: string, name: string): Promise<void>;
	destroyMailbox(id: string): Promise<void>;
	/** The id of the mailbox with `role`, or `null` when the account has none. */
	roleId(role: MailboxRole): Promise<string | null>;
	/** Forgets the role map (mailboxes changed). */
	forgetRoles(): void;
}

export function createMailboxMethods(
	client: JmapClient,
	tracker: ChangeTracker,
	nudge: () => void,
): MailboxMethods {
	let roles: Map<string, string> | null = null;

	const learnRoles = (list: readonly JmapObject[]): void => {
		roles = new Map();
		for (const mailbox of list)
			if (typeof mailbox.role === 'string' && mailbox.role)
				roles.set(mailbox.role.toLowerCase(), mailbox.id);
	};

	/** More mailboxes than one `/get` may return: list their ids, then fetch them in batches. */
	const getByQuery = async (properties: readonly string[]): Promise<JmapObject[]> => {
		const { result, calls } = await client.request((builder, accountId) =>
			builder.call('Mailbox/query', { accountId }),
		);
		const found: JmapObject[] = [];
		await client.batch(
			strings(result.get(calls).ids),
			(limits) => limits.maxObjectsInGet,
			(builder, accountId, ids) => builder.call('Mailbox/get', { accountId, ids, properties }),
			(page, call) => {
				const args = page.get(call);
				tracker.observe('Mailbox', args.state);
				found.push(...objects(args.list));
			},
		);
		return found;
	};

	const getAll = async (properties: readonly string[]): Promise<JmapObject[]> => {
		const { result, calls } = await client.request((builder, accountId) =>
			builder.call('Mailbox/get', { accountId, ids: null, properties }),
		);
		if (result.error(calls)?.type === 'requestTooLarge') return getByQuery(properties);
		const args = result.get(calls);
		tracker.observe('Mailbox', args.state);
		return objects(args.list);
	};

	const methods: MailboxMethods = {
		async mailboxes() {
			const list = await getAll(PROPERTIES);
			learnRoles(list);
			return list.map(toMailbox);
		},
		async createMailbox(input) {
			const parentId = input.parentId ?? null;
			const { result, calls } = await client.request((builder, accountId) =>
				builder.call('Mailbox/set', {
					accountId,
					create: {
						mailbox: { name: input.name, parentId, ...(input.role ? { role: input.role } : {}) },
					},
				}),
			);
			const id = result.created(calls, 'mailbox');
			const created = result.get(calls).created as Record<string, Record<string, unknown>>;
			methods.forgetRoles();
			nudge();
			// What the server set (counts, sort order, a normalised name) wins over what was sent.
			return toMailbox({
				name: input.name,
				parentId,
				role: input.role ?? null,
				...created.mailbox,
				id,
			});
		},
		async renameMailbox(id, name) {
			const { result, calls } = await client.request((builder, accountId) =>
				builder.call('Mailbox/set', { accountId, update: { [id]: { name } } }),
			);
			result.set(calls);
			nudge();
		},
		async destroyMailbox(id) {
			const { result: probe, calls: get } = await client.request((builder, accountId) =>
				builder.call('Mailbox/get', { accountId, ids: [id], properties: ['role'] }),
			);
			const found = objects(probe.get(get).list).find((mailbox) => mailbox.id === id);
			if (!found) throw new MailTransportError('notFound', 'The folder no longer exists.');
			// Any role counts, also the ones the model does not know (`all`, `important`, ...).
			if (typeof found.role === 'string' && found.role)
				throw new MailTransportError('forbidden', 'Special folders cannot be deleted.');
			const { result, calls } = await client.request((builder, accountId) =>
				builder.call('Mailbox/set', { accountId, destroy: [id], onDestroyRemoveEmails: false }),
			);
			result.set(calls);
			methods.forgetRoles();
			nudge();
		},
		async roleId(role) {
			if (!roles) learnRoles(await getAll(['role']));
			return roles?.get(role) ?? null;
		},
		forgetRoles() {
			roles = null;
		},
	};
	return methods;
}
