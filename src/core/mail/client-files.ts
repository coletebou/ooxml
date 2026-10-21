// The file actions on messages: download an attachment, export a message as `.eml` and import
// `.eml` files into a folder. New code.
import type { ClientCore } from './client-core';
import type { ListLoader } from './client-list';
import type { FileInput, MailClient } from './client-types';
import { emlFileName } from './eml';

type FileActions = Pick<MailClient, 'download' | 'exportEml' | 'importEml'>;

export function createFileActions(core: ClientCore, list: ListLoader): FileActions {
	return {
		async download(attachment) {
			try {
				return await core.transport.download(attachment.blobId, {
					type: attachment.type,
					name: attachment.name,
				});
			} catch (error) {
				core.fail('download', error);
				throw error;
			}
		},
		async exportEml(emailId) {
			const email =
				core.emails.get(emailId) ??
				core.bodies.get(emailId) ??
				(await core.transport.message(emailId));
			const name = emlFileName(email.subject);
			const bytes = await core.transport.download(email.blobId, { type: 'message/rfc822', name });
			return { name, type: 'message/rfc822', bytes };
		},
		async importEml(files: readonly FileInput[], mailboxId) {
			const target = mailboxId ?? core.state.mailboxId ?? core.mailboxByRole('inbox')?.id;
			if (!target || !files.length) return;
			let count = 0;
			for (const file of files) {
				try {
					await core.transport.importMessage(file.bytes, target);
					count++;
				} catch (error) {
					core.fail('import', error);
				}
			}
			if (count) {
				core.notice({ kind: 'done', action: 'imported', count });
				await list.loadList();
			}
		},
	};
}
