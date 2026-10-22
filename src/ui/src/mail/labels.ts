// Names the mail views show for things the server names: special-use folders appear under their
// localised names (servers often name them in another language); the person's own keep theirs.
import type { Mailbox } from 'ooxml-core/mail';
import type { MailI18n, MailKey } from './i18n/translator';

const ROLE_KEYS: Record<string, MailKey> = {
	inbox: 'folder.inbox',
	drafts: 'folder.drafts',
	sent: 'folder.sent',
	archive: 'folder.archive',
	junk: 'folder.junk',
	trash: 'folder.trash',
};

/** The name a folder is shown under. */
export function folderLabel(mailbox: Pick<Mailbox, 'name' | 'role'>, i18n: MailI18n): string {
	const key = mailbox.role ? ROLE_KEYS[mailbox.role] : undefined;
	return key ? i18n.t(key) : mailbox.name;
}
