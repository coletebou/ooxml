// The React binding on one page:
//   <Notebook />    the whole app (the <notebook-app> element)
//   useNotebook()   the same notebooks through the raw client, in the bar at the bottom: state
//                   in, actions out. The bar mounts its client only while it is open, so a closed
//                   bar never adds a second person to the notebook.
import {
	Notebook,
	useNotebook,
	type CreateNotebookOptions,
	type NotebookTheme,
} from 'opennotebook-react-viewer';
import { useEffect, useMemo, useState } from 'react';
import {
	currentHostClass,
	onHostClass,
	recordExport,
	recordNavigate,
	recordOpenFile,
	recordReady,
} from '../../test-hooks';

const params = new URLSearchParams(location.search);
const name = params.get('name') || 'Ada';
const userId = params.get('id') || `demo-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
// ?locale=de shows the app in German; en, de, es, fr and zh-CN ship, empty keeps English.
const locale = params.get('locale') ?? '';
// ?storage=<name> is the IndexedDB database, so each browser test (or visitor) gets its own
// notebooks.
const storageName = params.get('storage') || 'notebook-demo';
const THEMES: readonly NotebookTheme[] = ['system', 'light', 'dark'];
const theme = THEMES.find((value) => value === params.get('theme')) ?? 'system';
/** `?theme=light` or `?theme=dark` (which also colours the page), else null. */
export const forcedTheme = theme === 'system' ? null : theme;

export function App() {
	// The host class goes through the binding; the browser tests swap it (../../test-hooks).
	const [hostClass, setHostClass] = useState(currentHostClass);
	useEffect(() => onHostClass(setHostClass), []);
	return (
		<div className="demo">
			<Notebook
				className={hostClass}
				userName={name}
				userId={userId}
				locale={locale}
				storageName={storageName}
				theme={theme}
				onReady={recordReady}
				onNavigate={recordNavigate}
				onOpenFile={recordOpenFile}
				onExport={recordExport}
			/>
			<RawHookBar />
		</div>
	);
}

/** Collapsed by default: one line under the app. */
function RawHookBar() {
	const [open, setOpen] = useState(false);
	return (
		<details className="raw-hook" onToggle={(event) => setOpen(event.currentTarget.open)}>
			<summary>
				Raw hook: <code>useNotebook()</code> over the same notebooks, without the UI
			</summary>
			{open ? <RawHookCounts /> : null}
		</details>
	);
}

/** A few counts from a second client over the same storage, as another tab would see them. */
function RawHookCounts() {
	const options = useMemo<CreateNotebookOptions>(
		() => ({
			// Shown to the app as another person while the bar is open.
			user: { id: `${userId}-hook`, name: 'Raw hook' },
			storageName,
			locale,
			// The app creates the first notebook; this client only reads what is there.
			createDefault: false,
		}),
		[],
	);
	const { state } = useNotebook(options);
	const rows: [string, string | number][] = state?.ready
		? [
				['Notebooks', state.notebooks.length],
				['Open', state.notebook?.name ?? 'none'],
				['Sections', state.sections.filter((section) => section.kind === 'section').length],
				[`Pages in ${state.section?.name ?? 'no section'}`, state.pages.length],
				['To-dos', state.todos.length],
				['Others here', state.peers.length],
			]
		: [['Status', 'opening']];
	return (
		<dl>
			{rows.map(([label, value]) => (
				<div key={label}>
					<dt>{label}</dt>
					<dd>{value}</dd>
				</div>
			))}
		</dl>
	);
}
