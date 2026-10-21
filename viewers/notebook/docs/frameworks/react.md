# React

`opennotes-react-viewer` (peer: `react` 18 or later) gives you the whole app as `<Notebook />`
and the raw client as hooks.

```bash
npm install opennotes-react-viewer react
```

## The component

```tsx
import { Notebook } from 'opennotes-react-viewer';

export function Notes({ user }: { user: { id: string; name: string } }) {
	return (
		<Notebook
			className="notes"
			userName={user.name}
			userId={user.id}
			storageName={`notes-${user.id}`}
			locale="de"
			theme="system"
			onNavigate={({ pageId }) => console.log('page', pageId)}
			onOpenFile={(detail, event) => {
				if (detail.kind === 'docx') {
					event.preventDefault();
					openInWord(detail.bytes, detail.name);
				}
			}}
			onExport={(detail, event) => {
				event.preventDefault();
				upload(detail.fileName, detail.bytes);
			}}
		/>
	);
}
```

The element is `display: block; height: 100%`, so give its parent a height. Props are applied
before the element's first update and after every render, and only changed values reach the
element. `className` sets the host element's class. The ref is the `<notebook-app>` element
itself: its `client` getter returns the core client.

Every prop is optional:

| Prop          | Meaning                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------- |
| `userName`    | Display name shown to collaborators.                                                      |
| `userId`      | Stable id for presence; defaults to one remembered in this browser.                       |
| `storageName` | The IndexedDB database for this user's notebooks (default `ooxml-notebooks`).             |
| `locale`      | `en`, `de`, `es`, `fr` or `zh-CN`; any other tag maps to one of them or English.          |
| `theme`       | `system`, `light` or `dark`.                                                              |
| `config`      | `{ mode: 'local' }` (the default) or `{ mode: 'server', syncUrl, token? }`.               |
| `onReady`     | `({ user })`: the notebooks are loaded.                                                   |
| `onNavigate`  | `({ notebookId, sectionId, pageId })`: the open notebook, section or page changed.        |
| `onOpenFile`  | `(detail, event)`: an embedded file was opened; `preventDefault()` to handle it yourself. |
| `onExport`    | `(detail, event)`: an export is ready; `preventDefault()` to save it yourself.            |

## The hooks

```tsx
import { useMemo } from 'react';
import { useNotebook, type CreateNotebookOptions } from 'opennotes-react-viewer';

function Outline({ userId }: { userId: string }) {
	const options = useMemo<CreateNotebookOptions>(
		() => ({ user: { id: userId, name: 'Ada' }, storageName: `notes-${userId}` }),
		[userId],
	);
	const { client, state } = useNotebook(options);
	if (!client || !state?.ready) return <p>Opening…</p>;
	return (
		<nav>
			{state.sections.map((section) => (
				<button key={section.id} onClick={() => client.selectSection(section.id)}>
					{section.name} ({section.pageCount})
				</button>
			))}
			<button onClick={() => client.createPage({ title: 'New idea' })}>Add a page</button>
		</nav>
	);
}
```

`useNotebook` is `useNotebookClient` plus `useNotebookState` (`useSyncExternalStore`). The client
is created after mount, recreated when the user, `config`, `storageName` or `scope` change, and
destroyed (after saving) on unmount; it is `null` until then, and while `options` is `null`. Keep
`options` stable (`useMemo`).

A hook client and a `<Notebook>` on the same `storageName` share the device's notebooks like two
tabs do. Pass `createDefault: false` to a hook client that should never create the first notebook
itself.

The [React demo](/demo/){target="_self"} uses both on one page: `demos/notebook/react/src/App.tsx`
in the repository.
