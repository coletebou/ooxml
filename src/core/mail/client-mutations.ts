// What the toolbar and the keyboard do to messages: read and unread, flags, moves (archive, junk,
// trash) and folders. Each change is applied to the list at once and put back if the server
// refuses it; moves can be undone from their notice. New code.
import type { ClientCore } from './client-core';
import type { ListLoader } from './client-list';
import type { MailClient, MailNotice, Targets } from './client-types';
import { FLAGGED, SEEN, type EmailSummary, type MailboxRole } from './model';
import { MailTransportError, type EmailPatch } from './transport';

type Mutations = Pick<
	MailClient,
	| 'markRead'
	| 'toggleRead'
	| 'setFlagged'
	| 'toggleFlagged'
	| 'moveTo'
	| 'archive'
	| 'markJunk'
	| 'remove'
	| 'createMailbox'
	| 'renameMailbox'
	| 'deleteMailbox'
>;

const withKeyword = (email: EmailSummary, keyword: string, on: boolean): EmailSummary => {
	const keywords: Record<string, true> = { ...email.keywords };
	if (on) keywords[keyword] = true;
	else delete keywords[keyword];
	return { ...email, keywords };
};

export function createMutations(core: ClientCore, list: ListLoader): Mutations {
	const setKeyword = async (keyword: string, on: boolean, ids: Targets): Promise<void> => {
		const targets = core
			.emailIdsOf(ids)
			.filter((id) => (core.emails.get(id)?.keywords[keyword] === true) !== on);
		if (!targets.length) return;
		const revert = core.applyLocal(targets, (email) => withKeyword(email, keyword, on));
		try {
			await core.transport.update(
				Object.fromEntries(targets.map((id) => [id, { keywords: { [keyword]: on } }])),
			);
		} catch (error) {
			revert();
			core.fail('update', error);
		}
	};

	/** Patches that take each message out of where it is now and into `mailboxId`. */
	const movePatches = (
		emailIds: readonly string[],
		mailboxId: string,
	): Record<string, EmailPatch> => {
		const viewing =
			core.state.query && core.state.searchScope === 'all' ? null : core.state.mailboxId;
		const patches: Record<string, EmailPatch> = {};
		for (const id of emailIds) {
			const email = core.emails.get(id);
			if (!email || (email.mailboxIds.length === 1 && email.mailboxIds[0] === mailboxId)) continue;
			const leaving = viewing && email.mailboxIds.includes(viewing) ? [viewing] : email.mailboxIds;
			patches[id] = {
				mailboxIds: {
					...Object.fromEntries(
						leaving.filter((box) => box !== mailboxId).map((box) => [box, false]),
					),
					[mailboxId]: true,
				},
			};
		}
		return patches;
	};

	const applyPatches = (patches: Record<string, EmailPatch>): (() => void) =>
		core.applyLocal(Object.keys(patches), (email) => {
			const boxes = new Set(email.mailboxIds);
			for (const [box, on] of Object.entries(patches[email.id]?.mailboxIds ?? {}))
				if (on) boxes.add(box);
				else boxes.delete(box);
			return { ...email, mailboxIds: [...boxes] };
		});

	/** The patches that undo `patches`, from the messages' current mailboxes. */
	const inverse = (patches: Record<string, EmailPatch>): Record<string, EmailPatch> =>
		Object.fromEntries(
			Object.entries(patches).map(([id, patch]) => [
				id,
				{
					mailboxIds: Object.fromEntries(
						Object.entries(patch.mailboxIds ?? {}).map(([box, on]) => [box, !on]),
					),
				},
			]),
		);

	const hideMoved = (patches: Record<string, EmailPatch>): void => {
		const viewing = core.state.mailboxId;
		if (core.state.query && core.state.searchScope === 'all') return;
		const gone = new Set(
			Object.entries(patches)
				.filter(([, patch]) => viewing && patch.mailboxIds?.[viewing] === false)
				.map(([id]) => id),
		);
		if (!gone.size) return;
		core.listIds = core.listIds.filter((id) => !gone.has(id));
		core.rebuild();
	};

	const move = async (
		mailboxId: string,
		ids: Targets,
		action: 'moved' | 'archived' | 'junk' | 'deleted',
	): Promise<void> => {
		const patches = movePatches(core.emailIdsOf(ids), mailboxId);
		const count = Object.keys(patches).length;
		if (!count) return;
		const listBefore = core.listIds;
		const revert = applyPatches(patches);
		hideMoved(patches);
		try {
			await core.transport.update(patches);
		} catch (error) {
			core.listIds = listBefore;
			revert();
			core.fail('move', error);
			return;
		}
		const target = core.mailboxes.find((mailbox) => mailbox.id === mailboxId)?.name;
		const notice: MailNotice = {
			kind: 'done',
			action,
			count,
			...(target ? { target } : {}),
			undo: async () => {
				try {
					await core.transport.update(inverse(patches));
					await list.loadList();
					core.notice({ kind: 'done', action: 'undone', count });
				} catch (error) {
					core.fail('move', error);
				}
			},
		};
		core.notice(notice);
	};

	const moveToRole = async (
		role: MailboxRole,
		ids: Targets,
		action: 'archived' | 'junk' | 'deleted',
	): Promise<void> => {
		const mailbox = core.mailboxByRole(role);
		if (!mailbox) {
			core.fail('move', new MailTransportError('unsupported', `No ${role} folder.`));
			return;
		}
		await move(mailbox.id, ids, action);
	};

	const mailboxAction = async (run: () => Promise<unknown>): Promise<void> => {
		try {
			await run();
			await list.loadMailboxes();
		} catch (error) {
			core.fail('mailbox', error);
		}
	};

	return {
		markRead: (read, ids) => setKeyword(SEEN, read, ids),
		toggleRead: (ids) => {
			const targets = core.emailIdsOf(ids);
			const anyUnread = targets.some((id) => !core.emails.get(id)?.keywords[SEEN]);
			return setKeyword(SEEN, anyUnread, targets);
		},
		setFlagged: (flagged, ids) => setKeyword(FLAGGED, flagged, ids),
		toggleFlagged: (ids) => {
			const targets = core.emailIdsOf(ids);
			const anyFlagged = targets.some((id) => core.emails.get(id)?.keywords[FLAGGED]);
			return setKeyword(FLAGGED, !anyFlagged, targets);
		},
		moveTo: (mailboxId, ids) => move(mailboxId, ids, 'moved'),
		archive: (ids) => moveToRole('archive', ids, 'archived'),
		markJunk: (ids) => moveToRole('junk', ids, 'junk'),
		async remove(ids) {
			const trash = core.mailboxByRole('trash');
			const targets = core.emailIdsOf(ids);
			const inTrash = targets.filter((id) => {
				const boxes = core.emails.get(id)?.mailboxIds ?? [];
				return !trash || (boxes.length === 1 && boxes[0] === trash.id);
			});
			const elsewhere = targets.filter((id) => !inTrash.includes(id));
			if (elsewhere.length) await moveToRole('trash', elsewhere, 'deleted');
			if (!inTrash.length) return;
			core.listIds = core.listIds.filter((id) => !inTrash.includes(id));
			core.rebuild();
			try {
				await core.transport.destroy(inTrash);
				core.notice({ kind: 'done', action: 'deleted', count: inTrash.length });
			} catch (error) {
				await list.loadList();
				core.fail('delete', error);
			}
		},
		createMailbox: (name, parentId) =>
			mailboxAction(() => core.transport.createMailbox({ name, parentId: parentId ?? null })),
		renameMailbox: (id, name) => mailboxAction(() => core.transport.renameMailbox(id, name)),
		deleteMailbox: (id) => mailboxAction(() => core.transport.destroyMailbox(id)),
	};
}
