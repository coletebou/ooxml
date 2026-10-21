// What the toolbar and the keyboard do to messages: read and unread, flags, moves (archive, junk,
// trash) and folders. Each change is applied to the list at once and put back if the server
// refuses it, for the messages it refuses it for: a server changes each on its own. Moves can be
// undone from their notice. New code.
import type { ClientCore } from './client-core';
import type { ListLoader } from './client-list';
import type { MailClient, Targets } from './client-types';
import { FLAGGED, SEEN, type EmailSummary, type MailboxRole } from './model';
import { MailTransportError, PartialUpdateError, type EmailPatch } from './transport';

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
> & {
	/**
	 * Mark exactly these messages read. Unlike `markRead`, an id is never taken for the
	 * conversation it starts (a conversation's id is its first message's).
	 */
	markSeen(emailIds: readonly string[]): Promise<void>;
};

const withKeyword = (email: EmailSummary, keyword: string, on: boolean): EmailSummary => {
	const keywords: Record<string, true> = { ...email.keywords };
	if (on) keywords[keyword] = true;
	else delete keywords[keyword];
	return { ...email, keywords };
};

/** The messages a failed update changed all the same: those it names when it made only some. */
const changedBy = (error: unknown): ReadonlySet<string> =>
	new Set(error instanceof PartialUpdateError ? error.updated : []);

/** The patches of `patches` for the messages `ids`. */
const only = (
	patches: Readonly<Record<string, EmailPatch>>,
	ids: ReadonlySet<string>,
): Record<string, EmailPatch> =>
	Object.fromEntries(Object.entries(patches).filter(([id]) => ids.has(id)));

export function createMutations(core: ClientCore, list: ListLoader): Mutations {
	/** Sets `keyword` on the messages `emailIds` (resolved already, see `emailIdsOf`). */
	const setKeyword = async (
		keyword: string,
		on: boolean,
		emailIds: readonly string[],
	): Promise<void> => {
		const targets = emailIds.filter(
			(id) => (core.emails.get(id)?.keywords[keyword] === true) !== on,
		);
		if (!targets.length) return;
		const change = (email: EmailSummary): EmailSummary => withKeyword(email, keyword, on);
		const revert = core.applyLocal(targets, change);
		try {
			await core.transport.update(
				Object.fromEntries(targets.map((id) => [id, { keywords: { [keyword]: on } }])),
			);
		} catch (error) {
			revert();
			core.fail('update', error);
			const changed = changedBy(error);
			const kept = targets.filter((id) => changed.has(id));
			if (kept.length) core.applyLocal(kept, change);
		}
	};

	/** Patches that take each message out of where it is now and into `mailboxId`. */
	const movePatches = (
		emailIds: readonly string[],
		mailboxId: string,
	): Record<string, EmailPatch> => {
		const viewing = core.listMailboxId();
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

	/**
	 * The patches that undo `patches`: each mailbox they touch set back to whether the message is in
	 * it now, so a message that was in the target already stays there.
	 */
	const restorePatches = (patches: Record<string, EmailPatch>): Record<string, EmailPatch> =>
		Object.fromEntries(
			Object.entries(patches).map(([id, patch]) => {
				const boxes = new Set(core.emails.get(id)?.mailboxIds);
				const touched = Object.keys(patch.mailboxIds ?? {});
				return [
					id,
					{ mailboxIds: Object.fromEntries(touched.map((box) => [box, boxes.has(box)])) },
				];
			}),
		);

	const hideMoved = (patches: Record<string, EmailPatch>): void => {
		const viewing = core.listMailboxId();
		if (!viewing) return;
		const gone = new Set(
			Object.entries(patches)
				.filter(([, patch]) => patch.mailboxIds?.[viewing] === false)
				.map(([id]) => id),
		);
		if (!gone.size) return;
		core.listIds = core.listIds.filter((id) => !gone.has(id));
		core.rebuild();
	};

	/**
	 * Applies folder `patches` at once and then on the server; resolves to those the server made.
	 * What it did not make is put back, with a notice saying why; what it made before refusing the
	 * rest stays made.
	 */
	const moveNow = async (
		patches: Record<string, EmailPatch>,
	): Promise<Record<string, EmailPatch>> => {
		const listBefore = core.listIds;
		const revert = applyPatches(patches);
		hideMoved(patches);
		try {
			await core.transport.update(patches);
			return patches;
		} catch (error) {
			core.listIds = listBefore;
			revert();
			core.fail('move', error);
			const made = only(patches, changedBy(error));
			if (Object.keys(made).length) {
				applyPatches(made);
				hideMoved(made);
			}
			return made;
		}
	};

	/** Moves as `patches` say, with a notice that undoes the moves the server made. */
	const commit = async (
		patches: Record<string, EmailPatch>,
		action: 'moved' | 'archived' | 'junk' | 'deleted',
		target?: string,
	): Promise<void> => {
		if (!Object.keys(patches).length) return;
		const restore = restorePatches(patches);
		const moved = Object.keys(await moveNow(patches));
		if (!moved.length) return;
		const back = only(restore, new Set(moved));
		core.notice({
			kind: 'done',
			action,
			count: moved.length,
			...(target ? { target } : {}),
			undo: async () => {
				const undone = Object.keys(await moveNow(back)).length;
				if (!undone) return;
				await list.loadList();
				core.notice({ kind: 'done', action: 'undone', count: undone });
			},
		});
	};

	const move = (
		mailboxId: string,
		ids: Targets,
		action: 'moved' | 'archived' | 'junk' | 'deleted',
	): Promise<void> =>
		commit(
			movePatches(core.emailIdsOf(ids), mailboxId),
			action,
			core.mailboxes.find((mailbox) => mailbox.id === mailboxId)?.name,
		);

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
		markSeen: (emailIds) => setKeyword(SEEN, true, emailIds),
		markRead: (read, ids) => setKeyword(SEEN, read, core.emailIdsOf(ids)),
		toggleRead: (ids) => {
			const targets = core.emailIdsOf(ids);
			const anyUnread = targets.some((id) => !core.emails.get(id)?.keywords[SEEN]);
			return setKeyword(SEEN, anyUnread, targets);
		},
		setFlagged: (flagged, ids) => setKeyword(FLAGGED, flagged, core.emailIdsOf(ids)),
		toggleFlagged: (ids) => {
			const targets = core.emailIdsOf(ids);
			const anyFlagged = targets.some((id) => core.emails.get(id)?.keywords[FLAGGED]);
			return setKeyword(FLAGGED, !anyFlagged, targets);
		},
		moveTo: (mailboxId, ids) => move(mailboxId, ids, 'moved'),
		archive: (ids) => moveToRole('archive', ids, 'archived'),
		markJunk: (ids) => moveToRole('junk', ids, 'junk'),
		async remove(ids) {
			const targets = core.emailIdsOf(ids);
			if (!targets.length) return;
			// Roles are optional (RFC 8621): with no Trash to undo from, refuse rather than destroy.
			const trash = core.mailboxByRole('trash');
			if (!trash) {
				core.fail('delete', new MailTransportError('unsupported', 'No trash folder.'));
				return;
			}
			const boxesOf = (id: string): readonly string[] => core.emails.get(id)?.mailboxIds ?? [];
			// Only Delete in the Trash view takes mail out of Trash. Anywhere else, a search of every
			// folder included, it moves mail to Trash, where what is there already stays.
			const viewingTrash = core.listMailboxId() === trash.id;
			const inTrash = viewingTrash
				? targets.filter((id) => {
						const boxes = boxesOf(id);
						return boxes.length === 1 && boxes[0] === trash.id;
					})
				: [];
			// Deleted in Trash, a message filed in another folder too only leaves Trash: it stays in
			// the folders it was never deleted from. Only what is in Trash alone goes for good.
			const leaving = viewingTrash
				? targets.filter((id) => !inTrash.includes(id) && boxesOf(id).includes(trash.id))
				: [];
			const toTrash = targets.filter((id) => !inTrash.includes(id) && !leaving.includes(id));
			const patches = movePatches(toTrash, trash.id);
			for (const id of leaving) patches[id] = { mailboxIds: { [trash.id]: false } };
			await commit(patches, 'deleted', trash.name);
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
