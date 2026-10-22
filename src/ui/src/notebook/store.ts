// The raw, framework-neutral hook surface. Every binding wraps exactly this: create a client once,
// read `getState()` and call its actions. Use it to build your own UI without <notebook-app>.
//
//   const notebook = createNotebook({ user: { name: 'Ada' } });
//   const stop = notebook.subscribe(() => render(notebook.getState()));
//   notebook.createPage({ title: 'Ideas' });
import {
	type NotebookClient,
	type NotebookClientOptions,
	type NotebookStorage,
	createNotebookClient,
	scopeDigest,
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

/** The names new notebooks, sections and groups get in `locale` (for `client.setNames`). */
export function notebookNames(
	locale?: string,
): Required<NonNullable<NotebookClientOptions['names']>> {
	const t = notebookI18n(locale).t;
	return { notebook: t('name.notebook'), section: t('name.section'), group: t('name.group') };
}

/**
 * The scope the tabs of one database share their notebook list in. It is a digest of the whole
 * name, so two databases never share a scope (a cleaned-up or shortened name could: `notes.ada`
 * and `notes/ada`), which would mix their notebooks.
 */
export function notebookScope(storageName: string): string {
	return scopeDigest(storageName);
}

// Storages a host passed in without an id: each gets its own scope, kept while the object lives.
const objectScopes = new WeakMap<NotebookStorage, string>();

/**
 * The scope for a storage the host passed in: by its `id` (where its bytes go, as a database name
 * does), else one of its own, so two custom storages never share a notebook list.
 */
function storageScope(storage: NotebookStorage): string {
	if (storage.id) return notebookScope(storage.id);
	let scope = objectScopes.get(storage);
	if (!scope) {
		let hex = '';
		for (const byte of crypto.getRandomValues(new Uint8Array(16)))
			hex += byte.toString(16).padStart(2, '0');
		scope = `nb-${hex}`;
		objectScopes.set(storage, scope);
	}
	return scope;
}

/**
 * `createNotebookClient` with this browser's IndexedDB storage, user id and localized names, saving
 * what is pending when the page is left.
 */
export function createNotebook(options: CreateNotebookOptions = {}): NotebookClient {
	const {
		storageName = DEFAULT_NOTEBOOK_DATABASE,
		locale,
		user,
		storage,
		scope,
		...rest
	} = options;
	const own = storage ? null : createIndexedDbStorage(storageName);
	const client = createNotebookClient({
		storage: storage ?? own!,
		scope: scope ?? (storage ? storageScope(storage) : notebookScope(storageName)),
		names: notebookNames(locale),
		...rest,
		user: {
			id: user?.id ?? notebookUserId(),
			name: user?.name ?? 'Guest',
			...(user?.color ? { color: user.color } : {}),
		},
	});
	// Leaving the page (a navigation, the tab closing) need not unmount the binding first, so the
	// client saves what is pending itself; a failure was already announced as a notice.
	const onPageHide = (): void => void client.flush().catch(() => undefined);
	globalThis.addEventListener?.('pagehide', onPageHide);
	// The database this client opened is closed with it, so a restart does not leave connections
	// behind that block another tab's upgrade or a host deleting a signed-out profile's database.
	const destroy = client.destroy;
	client.destroy = async () => {
		globalThis.removeEventListener?.('pagehide', onPageHide);
		try {
			await destroy();
		} finally {
			own?.close();
		}
	};
	return client;
}
