# Getting started

OpenNotebook is an open-source, local-first notebook app: notebooks hold sections (and section
groups), sections hold pages with subpages, and every page is a free-form canvas of rich-text
containers, pictures, embedded Office files and ink. You install the React binding, mount one
component, and get the whole app; or use its raw hook to build your own UI over the same client.

::: warning An early implementation
OpenNotebook is an independent project. It is not a replacement for any commercial notebook app,
makes no claim of feature parity with one, and does not open legacy binary notebook files. See
[Limitations](/limitations) before you rely on it.
:::

## 1. Install the binding

```bash
npm install opennotebook-react-viewer react
```

| Package                     | For       | Peer dependency |
| --------------------------- | --------- | --------------- |
| `opennotebook-react-viewer` | React 18+ | `react`         |

The binding is self-contained: its thin wiring is bundled in, and
[`ooxml-core`](https://www.npmjs.com/package/ooxml-core) (the notebook logic) and
[`ooxml-ui`](https://www.npmjs.com/package/ooxml-ui) (the `<notebook-app>` element) install as
regular dependencies, together with `lit`. Other frameworks will follow the same pattern; until
then, any framework can use the element directly (below).

## 2. Mount it

```tsx
import { Notebook } from 'opennotebook-react-viewer';

export function Notes() {
	return (
		<div style={{ height: '100vh' }}>
			<Notebook userName="Ada" storageName="ada-notes" />
		</div>
	);
}
```

The component fills its parent (`display: block; height: 100%`), so give the parent a height. The
first run creates a notebook with one section and an empty page.

Or plain markup, in any framework or none, with the element straight from `ooxml-ui`
(`npm install ooxml-ui`):

```ts
import { defineNotebookApp } from 'ooxml-ui/notebook';

defineNotebookApp();
```

```html
<notebook-app user-name="Ada" storage-name="ada-notes" theme="system"></notebook-app>
```

Every way of mounting takes the same props: `userName`, `userId` (a stable id for presence;
defaults to one remembered in this browser), `locale`, `storageName`, `theme` and `config`, and
emits the same four events: ready, navigate, open file and export. See the
[element API](/api) and the [React guide](/frameworks/react).

## 3. Choose where notebooks live

Notebooks are always kept on the device, in an IndexedDB database named by `storageName`
(default `ooxml-notebooks`). Use one name per profile or signed-in user of your app, so their
notebooks stay apart. Without IndexedDB (blocked storage, some private windows) the app keeps
working in memory only, so nothing survives a reload.

`config` decides who else sees an open notebook:

| Mode     | `config`                               | What happens                                                                               |
| -------- | -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `local`  | omitted, `null` or `{ mode: 'local' }` | No server. Tabs of one browser share a notebook in real time over `BroadcastChannel`.      |
| `server` | `{ mode: 'server', syncUrl, token? }`  | The open notebook syncs through a y-websocket server at `<syncUrl>/<room>`, with presence. |

In server mode any stock y-websocket server works, for example the
[OpenTeams reference server](https://christophervr.github.io/ooxml/teams/server)'s `/sync`
endpoint (`ws://127.0.0.1:8787/sync` locally, `wss://` behind TLS). The optional `token` is sent
as `?token=`. The list of notebooks itself is per device and never goes to a server.

## 4. Or build your own UI

The binding also exposes the raw client: state in, plain actions out.

```tsx
import { useNotebook } from 'opennotebook-react-viewer';

const options = { user: { id: 'u-ada', name: 'Ada' }, storageName: 'ada-notes' };

function Pages() {
	const { client, state } = useNotebook(options);
	if (!client || !state?.ready) return <p>Opening…</p>;
	return (
		<ul>
			{state.pages.map((page) => (
				<li key={page.id}>
					<button onClick={() => client.selectPage(page.id)}>{page.title || 'Untitled'}</button>
				</li>
			))}
		</ul>
	);
}
```

`state` is one immutable `NotebookState` snapshot: the device's `notebooks`, the open `notebook`,
its `sections`, the selected section's `pages`, the selected page's `containers` and `strokes`,
`peers`, `canUndo` and `canRedo`, `searchResults` and `todos`. Actions include `createNotebook`,
`openNotebook`, `createSection`, `selectSection`, `createPage`, `selectPage`, `renamePage`,
`addText`, `addImage`, `addFile`, `addStroke`, `setTodo`, `search`, `undo`, `redo`, `exportPage`,
`exportNotebook` and `importNotebook`. [Architecture](/architecture) lists them all.

## Run it from source

Needs Node 22+ and Bun, in a checkout of the [`ooxml`](https://github.com/ChristopherVR/ooxml)
repository. The demo and the tests use the repository's own `ooxml-core` and `ooxml-ui` source.

```bash
bun install
cd viewers/notebook
bun run dev            # the React demo on http://127.0.0.1:5302
bun run typecheck      # needs src/core and src/ui built once (bun run build, bun run --cwd src/ui build)
bun run test           # vitest (jsdom)
bun run test:browser   # Playwright against the React demo (PLAYWRIGHT_PORT, default 5309)
```

The demo reads `?name=` (default `Ada`), `?locale=`, `?storage=` (the IndexedDB database, default
`notebook-demo`) and `?theme=`. Open `http://127.0.0.1:5302/?name=Ada` and, in another tab,
`...?name=Bob`: two people in one notebook.
