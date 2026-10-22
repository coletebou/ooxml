# Architecture

OpenNotes is split the same way as the other products built on
[`ooxml`](https://github.com/ChristopherVR/ooxml): the logic lives in `ooxml-core`, the app element
in `ooxml-ui`, and `viewers/notebook` holds only the framework binding, the demo, the browser tests
and this site.

| Layer               | Where                                                     | Owns                                                                         |
| ------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Logic               | `ooxml-core/notebook` (`src/core/notebook`)               | model, Yjs schema, commands, client store, search, to-dos, export, archives  |
| Editor without view | `ooxml-core/notebook/editor` (`src/core/notebook/editor`) | ProseMirror schema, commands, keymap, input rules, the y-prosemirror binding |
| Collaboration       | `ooxml-core/collab`                                       | Yjs sessions, transports (`BroadcastChannel`, WebSocket), awareness, assets  |
| App                 | `ooxml-ui/notebook` (`src/ui/src/notebook`)               | `<notebook-app>` and its parts, IndexedDB storage, translations              |
| Binding wiring      | `packages/web-component` here (private `notebook-viewer`) | `bindNotebook` and `pickNotebookProps`, inlined into every binding           |
| Bindings            | `packages/react` here                                     | a lifecycle adapter plus raw hooks, published as `opennotes-react-viewer`    |

The core's own description of the area, with the shared document layout and the deterministic
structure rules, is
[`docs/notebook-area.md`](https://github.com/ChristopherVR/ooxml/blob/main/docs/notebook-area.md).

## The client: one state, plain actions

Everything a UI needs comes from one client, `createNotebookClient` in `ooxml-core/notebook`. The
UI wraps it as `createNotebook`, which adds this browser's IndexedDB storage, a remembered user id
and item names in the UI's language.

```ts
import { createMemoryStorage, createNotebookClient } from 'ooxml-core/notebook';

const notebook = createNotebookClient({
	user: { name: 'Ada' },
	storage: createMemoryStorage(), // the UI passes its IndexedDB storage
	config: { mode: 'local' }, // or { mode: 'server', syncUrl: 'wss://host/sync', token }
});
await notebook.whenReady();
const stop = notebook.subscribe(() => render(notebook.getState())); // coalesced per microtask
notebook.addText({ x: 40, y: 80 }); // a text container on the selected page
```

`getState()` returns one immutable `NotebookState`: the device's `notebooks`, the open `notebook`,
its `sections` (a flat outline with depths), the selected section's `pages` (levels and subpage
flags), the selected page's `containers` and `strokes`, `peers` (who else is in the notebook and
on which page and container), `canUndo` and `canRedo`, `searchResults` and `todos`. Every button is
an action:

- notebooks: `createNotebook`, `openNotebook`, `renameNotebook`, `setNotebookColor`,
  `moveNotebook`, `deleteNotebook`, `restoreNotebook`;
- sections and groups: `createSection`, `selectSection`, `renameSection`, `setSectionColor`,
  `moveSection`, `deleteSection`;
- pages: `createPage`, `selectPage`, `renamePage`, `movePage`, `indentPage`, `deletePage`,
  `restore`;
- the canvas: `addText`, `addImage`, `addFile`, `moveContainers`, `resizeContainer`,
  `bringToFront`, `deleteContainers`, `addStroke`, `eraseStrokes`, `focusContainer`, `setTodo`;
- `undo` and `redo` (your own edits only, never a collaborator's), `search`;
- export: `exportPage` (to .docx), `exportNotebook` and `importNotebook` (a zip archive).

Notices a user should see arrive as `on('notice', { code })`. The UI never touches Yjs directly
except through `textBinding(containerId)`, which hands a text container's shared fragment to the
ProseMirror editor: **state in, actions out**.

## `<notebook-app>`

One Lit element composes the navigation pane (notebooks, sections, pages, search), the page
canvas (text containers on ProseMirror, pictures, embedded files, ink) and the To Do pane, with
the shared `ooxml-ui` ribbon, menus, presence and notices. It owns the client's lifecycle: it
starts one when it connects, restarts it when the user, storage or sync settings change, saves
when the page is hidden, and saves and closes it when it disconnects. Colours, spacing and radii
come from the `ooxml-ui` tokens (`var(--office-...)`).

Embedded Word, Excel, PowerPoint and Visio files are rendered live and read-only by the suite's
own viewers, loaded on demand; any other file is a card.

## The binding

A binding is a lifecycle adapter: it creates `<notebook-app>`, forwards props and the host class
with `bindNotebook` and `pickNotebookProps` (`packages/web-component/src/bind.ts`, over
`applyNotebookProps` and `listenNotebookEvents` from `ooxml-ui/notebook`) and re-emits events. It
also exposes the raw hook over `createNotebook`:

| Binding | Component      | Raw hook                                                         |
| ------- | -------------- | ---------------------------------------------------------------- |
| React   | `<Notebook />` | `useNotebook(options)` (`useNotebookClient`, `useNotebookState`) |

A behaviour bug is fixed once, in `ooxml-ui` or the core. A wiring bug is fixed in every binding
in the same change, once there are more.

At build time `scripts/build-packages.mjs` inlines the private `notebook-viewer` wiring into the
framework bundle and flattens its declarations, so the published tarball imports only what its
manifest declares (`ooxml-core`, `ooxml-ui`, `lit` and the framework peer).

## Storage and sync

- **On the device.** One Yjs document per notebook and one for the device's list of notebooks,
  in IndexedDB (`storageName`), saved shortly after each change and when the page is hidden. A
  notebook is kept as a log: a save writes only what changed (a keystroke, not the pictures and
  files on the page), and the log is folded into one copy from time to time, which also leaves
  deleted content out. Tabs that cannot reach each other never write over each other's saves.
- **Local mode** (the default) needs no server: tabs of one browser share a notebook, and the list
  of notebooks, over `BroadcastChannel`.
- **Server mode** speaks the y-websocket wire format to `<syncUrl>/<room>`, one room per notebook
  (`nb-<id>`), with an optional `?token=`. The list of notebooks never leaves the device.
- Everything a peer wrote is re-validated when it is read back: unknown nodes and marks become
  text, links must be http, https or mailto, colours `#rrggbb`, coordinates are clamped.
