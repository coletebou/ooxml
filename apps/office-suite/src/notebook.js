/**
 * The Notebook app in the suite: <notebook-app> from ooxml-ui/notebook, loaded on first use, with
 * this profile's notebooks (their own IndexedDB database), its display name and the suite theme.
 * A Word, Excel, PowerPoint or Visio file embedded in a page opens in the suite's editor as a
 * library copy; any other file keeps the element's default, a download.
 */
import { notify, task } from './ui.js';
import { onTheme } from './themes.js';
import { applyOfficeTheme } from './theme-tokens.js';
import { currentProfile, notebookDatabase, onProfile } from './profile-state.js';

/** The names the library accepts; a macro-enabled or template file (.docm, .potx) downloads. */
const LIBRARY_FILE = /\.(docx|xlsx|pptx|vsdx)$/iu;

/** The embedded file's library key: its container id, or its content for an event without one. */
async function sourceKey(id, bytes) {
	if (id) return `notebook:${id}`;
	const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
	return `notebook:${Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export async function mountNotebook(host, store, open) {
	const { defineNotebookApp } = await import('ooxml-ui/notebook');
	defineNotebookApp();
	const notebook = document.createElement('notebook-app');
	const profile = currentProfile();
	// The page language when the notebook ships it, else English, as Teams does.
	notebook.locale = document.documentElement.lang || '';
	notebook.storageName = notebookDatabase();
	notebook.userName = profile.name;
	notebook.userId = profile.userId;
	notebook.addEventListener('notebook-open-file', (event) => {
		const { id, name, kind, bytes } = event.detail;
		if (kind === 'other' || !LIBRARY_FILE.test(name)) return;
		event.preventDefault();
		task(async () => {
			// Opening the file again returns to its copy and the edits made there, like a Teams
			// attachment; the copy is never written back into the page.
			const sourceUrl = await sourceKey(id, bytes);
			const doc =
				(await store.list()).find((d) => d.sourceUrl === sourceUrl) ??
				(await store.create(name, bytes, { sourceUrl }));
			await open(doc.id, undefined, { focus: true });
			notify(`${doc.name} opened as a library copy. Saving it does not change the notebook page.`);
		});
	});
	// Themed before the first render, so the notebook never paints in the other mode first.
	onTheme(({ mode, accent }) => {
		notebook.theme = mode;
		applyOfficeTheme(notebook, { mode, accent });
	});
	onProfile((p) => {
		if (notebook.userName !== p.name) notebook.userName = p.name;
	});
	host.append(notebook);
	await notebook.updateComplete;
	return notebook;
}
