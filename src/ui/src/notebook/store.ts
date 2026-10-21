// The raw, framework-neutral hook surface. Every binding wraps exactly this: create a client once,
// read `getState()` and call its actions. Use it to build your own UI without <notebook-app>.
//
//   const notebook = createNotebook({ user: { name: 'Ada' } });
//   const stop = notebook.subscribe(() => render(notebook.getState()));
//   notebook.createPage({ title: 'Ideas' });
import {
	type NotebookClient,
	type NotebookClientOptions,
	createNotebookClient,
} from 'ooxml-core/notebook';
import { notebookI18n } from './i18n/translator';
import { createIndexedDbStorage, DEFAULT_NOTEBOOK_DATABASE, notebookUserId } from './storage';

export type {
	Container,
	InkStroke,
	NotebookClient,
	NotebookClientOptions,
	NotebookEntry,
	NotebookState,
	NotebookSyncConfig,
	PageView,
	PeerView,
	SearchHit,
	SectionView,
	TodoItem,
} from 'ooxml-core/notebook';

export interface CreateNotebookOptions extends Omit<NotebookClientOptions, 'user'> {
	user?: NotebookClientOptions['user'];
	/** IndexedDB database for this profile's notebooks (default `ooxml-notebooks`). */
	storageName?: string;
	/** Language of the names new notebooks, sections and groups get. */
	locale?: string;
}

/** `createNotebookClient` with this browser's IndexedDB storage, user id and localized names. */
export function createNotebook(options: CreateNotebookOptions = {}): NotebookClient {
	const { storageName = DEFAULT_NOTEBOOK_DATABASE, locale, user, ...rest } = options;
	const t = notebookI18n(locale).t;
	return createNotebookClient({
		storage: createIndexedDbStorage(storageName),
		scope: storageName.replace(/[^\w-]/gu, '-').slice(0, 48),
		names: { notebook: t('name.notebook'), section: t('name.section'), group: t('name.group') },
		...rest,
		user: {
			id: user?.id ?? notebookUserId(),
			name: user?.name ?? 'Guest',
			...(user?.color ? { color: user.color } : {}),
		},
	});
}
