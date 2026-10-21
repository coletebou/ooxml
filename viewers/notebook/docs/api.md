# Element API and events

The React binding wraps the `<notebook-app>` custom element from `ooxml-ui/notebook`. It forwards
these properties and re-emits these events (see the [React guide](/frameworks/react)); in plain
markup, call `defineNotebookApp()` once and use the element directly.

## Attributes and properties

| Property        | Attribute       | Description                                                                                                         |
| --------------- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `userName`      | `user-name`     | Display name, shown to collaborators. Falls back to the suite profile's name, then `Guest`.                         |
| `userId`        | `user-id`       | Stable id for presence; defaults to one remembered in this browser.                                                 |
| `storageName`   | `storage-name`  | The IndexedDB database for this profile's notebooks. Default `ooxml-notebooks`.                                     |
| `locale`        | `locale`        | Display language: `en`, `de`, `es`, `fr` or `zh-CN` (any BCP 47 tag maps to one of them; anything else is English). |
| `theme`         | `theme`         | `system` (default) follows the page, `light` or `dark` force one.                                                   |
| `config`        | `server-config` | Sync settings: `{ mode: 'local' }` or `{ mode: 'server', syncUrl, token? }`. The attribute takes JSON.              |
| `client` (read) |                 | The core client of the notebooks on screen (state in, actions out), or `null` before it starts.                     |

Changing `userId`, `userName`, `storageName` or `config` closes the current client (saving
first) and starts a new one. An invalid `server-config` falls back to local mode.

## Events

All events bubble and cross shadow roots (`composed`).

| Event                | Detail                              | Meaning                                                                                                                                                                                 |
| -------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notebook-ready`     | `{ user: { id, name } }`            | The notebook list is loaded and a notebook (if any) is open.                                                                                                                            |
| `notebook-navigate`  | `{ notebookId, sectionId, pageId }` | The open notebook, section or page changed.                                                                                                                                             |
| `notebook-open-file` | `{ id, name, mime, kind, bytes }`   | A user opened an embedded file. Cancelable: `preventDefault()` to open it yourself; by default it downloads. `kind` is `docx`, `xlsx`, `pptx`, `vsdx` or `other`.                       |
| `notebook-export`    | `{ fileName, mime, bytes, kind }`   | A page export (`kind: 'docx'`), a notebook archive (`'archive'`) or a downloaded file (`'file'`) is ready. Cancelable: `preventDefault()` to save it yourself; by default it downloads. |

Binding spellings: `onReady`, `onNavigate`, `onOpenFile` and `onExport` in React. The cancelable
ones receive `(detail, event)`, so a handler can call `event.preventDefault()`.

## The raw client

`createNotebook(options)` (from `ooxml-ui/notebook`, and `useNotebook` in React) returns the core
client with this browser's IndexedDB storage, a remembered user id and item names in the UI's
language. Options: `user` (`{ id?, name, color? }`), `config`, `storageName`, `locale`, and every
option of `createNotebookClient` (`storage` to bring your own, `scope`, `createDefault`, ...).

```ts
import { createNotebook } from 'ooxml-ui/notebook';

const notebook = createNotebook({ user: { name: 'Ada' }, storageName: 'ada-notes' });
await notebook.whenReady();
const stop = notebook.subscribe(() => render(notebook.getState())); // coalesced per microtask
notebook.createPage({ title: 'Ideas' });
notebook.on('notice', ({ code }) => show(code)); // save-failed, file-too-large, import-failed, ...
await notebook.destroy();
```

See [Architecture](/architecture) for the state, every action and how sync works.
