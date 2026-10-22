# The `notebook` area (`ooxml-core/notebook`)

The logic of a free-form notebook app that sits beside Word, Excel, PowerPoint, Visio and Teams.
A notebook holds section groups and sections (coloured tabs), a section holds pages (with
subpages by indent level), and every page is a canvas: rich-text containers placed anywhere,
pictures, embedded Office files and ink. It is **new code**, built on the `collab` area, and
DOM-free: storage, `WebSocket` and `BroadcastChannel` are injectable.

| Layer               | Where                                                      | Owns                                                                        |
| ------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| Logic               | `src/core/notebook/` (this area)                           | model, Yjs schema, commands, client store, search, to-dos, export, archives |
| Editor without view | `src/core/notebook/editor/` (`ooxml-core/notebook/editor`) | ProseMirror schema, commands, keymap, input rules, y-prosemirror binding    |
| App                 | `src/ui/src/notebook/` (`ooxml-ui/notebook`)               | `<notebook-app>` and its parts, IndexedDB storage, i18n                     |
| Bindings, demos     | `viewers/notebook`, `demos/notebook`, `e2e/notebook`       | React binding (more frameworks later), demo, browser tests, docs            |

The main entry never imports ProseMirror; the editor is its own subpath, as `docx/ui` is for Word.

## The client: one state, plain actions

```ts
import { createNotebookClient, createMemoryStorage } from 'ooxml-core/notebook';

const notebook = createNotebookClient({
	user: { name: 'Ada' },
	storage: createMemoryStorage(), // the UI passes its IndexedDB storage
	config: { mode: 'local' }, // or { mode: 'server', syncUrl: 'wss://host/sync', token }
});
await notebook.whenReady();
const stop = notebook.subscribe(() => render(notebook.getState())); // coalesced per microtask
notebook.addText({ x: 40, y: 80 }); // a text container on the selected page
```

`getState()` returns one immutable `NotebookState`: the device's `notebooks`, the open
`notebook`, its `sections` (a flat outline with depths), the selected section's `pages` (levels
and subpage flags), the selected page's `containers` and `strokes`, `peers` (who else is in the
notebook and on which page and container), `canUndo` / `canRedo`, `searchResults` and `todos`.
Every button is an action: notebooks (`createNotebook`, `openNotebook`, `renameNotebook`,
`setNotebookColor`, `moveNotebook`, `deleteNotebook`, `restoreNotebook`), sections and groups
(`createSection`, `selectSection`, `renameSection`, `setSectionColor`, `moveSection`,
`deleteSection`), pages (`createPage`, `selectPage`, `renamePage`, `movePage`, `indentPage`,
`deletePage`, `restore`), the canvas (`addText`, `addImage`, `addFile`, `moveContainers`,
`resizeContainer`, `bringToFront`, `deleteContainers`, `addStroke`, `eraseStrokes`,
`focusContainer`, `setTodo`), `undo` / `redo`, `search`, and export (`exportPage`,
`exportNotebook`, `importNotebook`). Notices arrive as `on('notice', { code })` with a code the UI
translates (`save-failed`, `file-too-large`, `import-failed`, ...).

`textBinding(containerId)` is the one place a UI meets Yjs: it returns the container's
`Y.XmlFragment`, the notebook's undo manager and the session's awareness, which
`createNotebookEditorState` (from `ooxml-core/notebook/editor`) turns into a ProseMirror state
bound through y-prosemirror.

## The shared document

One `Y.Doc` per notebook, which is also its sync room (`nb-<id>`). Top-level maps only, because
top-level types never conflict when two peers initialise a room at once:

- `notebook:meta`: schema version, name, colour, created.
- `notebook:sections`: id to a `Y.Map` (kind `section` or `group`, name, colour, parent group,
  fractional order, created, and `deleted` / `trash` when in the recycle bin).
- `notebook:pages`: id to a `Y.Map` (section, title, created, order, level 0-2, deleted, trash).
- `notebook:containers`: id to a `Y.Map` (page, kind `text` / `image` / `file`, x, y, w, h in
  CSS px, z). A text container's `content` is a `Y.XmlFragment` in the y-prosemirror encoding.
- `notebook:ink`: stroke id to plain JSON (page, tool `pen` / `highlighter`, colour, width,
  points as integers: tenths of a pixel and hundredths of pressure).
- `notebook:assets`: picture and file bytes, through collab `createAssetSync` (the container
  keeps a `_dataRef`).

Ids are minted per client (`createIdGenerator`), so concurrent adds never collide and each map is
created by one peer. Fields are set one by one, so a move and a concurrent resize both survive,
and text merges per character. Everything a peer wrote is re-validated when the core reads it
back (`read.ts`, `rich-text.ts`, which serve structure, search, to-dos, export and archives):
unknown nodes and marks are unwrapped to their text, links must be http, https or mailto (the
shared `opc/safe-href` policy), colours `#rrggbb`, coordinates are clamped. The editor builds its
document through y-prosemirror and the schema instead: its link mark only ever puts an http, https
or mailto address into an `href`, the Link dialog only offers such addresses, and y-prosemirror
drops content it cannot build from the schema.

**Deterministic structure rules.** A section whose group is missing sits at the top; groups put in
a cycle by concurrent moves all sit at the top; anything under a deleted group counts as deleted;
a page can only be a subpage of the page above it (levels are clamped on read). Orders are
fractional and minimal (`reorderFractional` from `collab/ordering`), ties broken by id.

**Deletes.** Sections, groups and pages are soft-deleted with a trash batch id, so `restore`
brings back exactly what one delete took (a page and its subpages), and a collaborator's edit
inside a deleted page survives. Containers and strokes are deleted outright; their asset bytes
stay so undo can bring a picture back. Notebooks are soft-deleted in the device's list and purged
a week later.

**Undo.** One `Y.UndoManager` per open notebook tracks only local origins (the notebook's edits and
the editor's sync plugin), so undo never reverts a collaborator's work. Discrete actions are one
step each; typing merges into steps of half a second.

## On the device

Each notebook is kept in the injected storage as a log (`journal.ts`): bases (whole states) and
entries (what one save changed), each under a key of its own, so a save writes only its changes and
clients on one storage that cannot reach each other never write over each other's saves. A
compaction stores one base made from the live document (deleted content is left out, which merging
stored updates would keep) and then removes only the keys it read or wrote, so another client's
newer save always stays and no lock is needed. This needs `loadPrefix` (one-step reads of a key
range); a storage without it keeps each notebook as one copy merged on every save.

## The device's notebooks

The list of notebooks is a small Yjs document of its own (`registry.ts`), saved in the injected
storage and shared between the tabs of one profile over `BroadcastChannel`, never a server. On a
first run the client waits briefly for another tab's list before creating a default notebook.

## Search and to-dos

`createTextIndex` caches the re-validated text of every container and invalidates one container
at a time through a deep observer. `searchNotebook` matches page titles and text ignoring case and
diacritics and cuts snippets from the original text. `collectTodos` lists every to-do tag in
section, page and reading order; `setTodoState` ticks one by its index and text (so a tag moved by
a collaborator is still found).

## Export and archives

- **Page to .docx** (`exportPageToDocx`, through the `docx` area): containers in reading order
  (top to bottom, then left to right, with a 16 px row band), headings as Heading 1-3, nested
  lists as Word numbering levels (a new list restarts numbering), to-do tags as Word checkbox
  content controls, bold, italic, underline, strikethrough, highlight and links as run properties,
  pictures inline (scaled to the text width), the page's ink as one PNG picture and an embedded
  file as a labelled line. Ink and pictures Word cannot show (WebP, SVG) need a rasteriser, which
  the UI supplies (it owns a canvas); without one they are listed in the report, never dropped
  silently.
- **Notebook archive** (`exportNotebookArchive` / `importNotebookArchive`): a zip with
  `notebook.json` (structure, text as ProseMirror-shaped JSON, ink points) and `media/`. Opening
  one goes through the shared zip guards (`opc/zip-limits`) and every value is re-validated.

## Sync

`local` (the default) needs no server: tabs of one browser share a notebook over
`BroadcastChannel`. `server` speaks the y-websocket wire format to `<syncUrl>/<room>`, for example
the Teams reference server's `/sync` endpoint, with an optional `?token=`.

## Honest limits

- **No import of legacy notebook files.** The binary `.one` format (MS-ONESTORE,
  `.onepkg` CAB archives) is not read; that codec would belong in a separate package, like `ole2`.
- Page positions do not survive export to .docx (a flowing document has none); the reading order
  above decides the sequence. Ink becomes a picture, not editable ink.
- A page title is one string: two people retitling a page at once keep one title.
- The eraser removes whole strokes; there is no partial erase, lasso or ink-to-text.
- No authentication or permissions here: anyone in the room can edit, as in the `collab` area.
  The registry is per device; there is no account-level list of notebooks.
- Asset bytes of deleted containers are not garbage-collected (as in `collab` assets); an archive
  export only carries what is still referenced.
- Not in this cut: audio notes, OCR, page templates, sharing permissions, a recycle-bin view.
