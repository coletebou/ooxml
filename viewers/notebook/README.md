<div align="center">

# OpenNotes

**An open-source, local-first notebook app: notebooks, sections and pages, each page a free-form canvas of rich text, pictures, embedded Office files and ink. One web component and a React binding.**
An early, independent implementation: not a replacement for any commercial notebook app.

[![docs](https://img.shields.io/badge/docs-christophervr.github.io-7a4cc2.svg)](https://christophervr.github.io/ooxml/notebook/)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![CI](https://github.com/ChristopherVR/ooxml/actions/workflows/ci.yml/badge.svg)](https://github.com/ChristopherVR/ooxml/actions/workflows/ci.yml)

[**Live demo**](https://christophervr.github.io/ooxml/notebook/demo/) &nbsp;&middot;&nbsp;
[**Documentation**](https://christophervr.github.io/ooxml/notebook/) &nbsp;&middot;&nbsp;
[**Getting started**](#getting-started) &nbsp;&middot;&nbsp;
[**Packages**](#packages)

Part of [ooxml](https://github.com/ChristopherVR/ooxml#readme): [Office](https://github.com/ChristopherVR/ooxml#ooxml-office-the-whole-suite-in-one-app) &middot; [Word](https://github.com/ChristopherVR/ooxml/tree/main/viewers/docx#readme) &middot; [Excel](https://github.com/ChristopherVR/ooxml/tree/main/viewers/xlsx#readme) &middot; [PowerPoint](https://github.com/ChristopherVR/ooxml/tree/main/viewers/pptx#readme) &middot; [Visio](https://github.com/ChristopherVR/ooxml/tree/main/viewers/visio#readme) &middot; [OpenTeams](https://github.com/ChristopherVR/ooxml/tree/main/viewers/teams#readme) &middot; **[OpenNotes](https://github.com/ChristopherVR/ooxml/tree/main/viewers/notebook#readme)** &middot; [Core](https://github.com/ChristopherVR/ooxml/tree/main/src/core#readme)

</div>

## Why OpenNotes?

- **Local first.** Notebooks live in the browser's IndexedDB. No account and no server are needed, and tabs of one browser share a notebook in real time.
- **Your sync server, if you want one.** Point it at any y-websocket server and people on other machines edit the same notebook, with presence.
- **Logic in one place.** The model, commands, search, export and sync live in [`ooxml-core/notebook`](https://github.com/ChristopherVR/ooxml/blob/main/docs/notebook-area.md), the `<notebook-app>` element in [`ooxml-ui`](https://github.com/ChristopherVR/ooxml/tree/main/src/ui). This folder holds the binding, the demo and the docs.
- **Honest limits.** What is not supported is written down, not hidden. See [limitations](https://christophervr.github.io/ooxml/notebook/limitations).

## Features and limitations

|                       |                                                                                                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Structure**         | Notebooks, section groups, coloured sections, and pages with two levels of subpages. Rename, recolour, reorder by drag or menu, and undo a delete from its notice.                                                                      |
| **Free-form pages**   | Click anywhere to type. Text containers, pictures and files sit where you put them: drag by the grip, resize from the corner, drop or paste pictures and files.                                                                         |
| **Rich text**         | Bold, italic, underline, strikethrough, highlight, three heading levels, bullet and numbered lists, links and to-do tags, with Markdown-style shortcuts (`* `, `1. `, `# `, `[] `).                                                     |
| **Ink**               | Pen and highlighter in six and four colours and three widths; the eraser removes whole strokes.                                                                                                                                         |
| **Office files**      | Word, Excel, PowerPoint and Visio files on a page are shown live and read-only by the suite's own viewers; any other file is a card you can open or download.                                                                           |
| **Search and to-dos** | Search page titles and text (ignoring case and accents), and a To Do pane that lists every to-do tag in the notebook.                                                                                                                   |
| **Export**            | A page as a Word document (`.docx`), and a whole notebook as an archive you can import again.                                                                                                                                           |
| **Sync**              | `local` (the default): tabs of one browser over `BroadcastChannel`. `server`: any y-websocket server, with an optional shared token.                                                                                                    |
| **Languages**         | English, German, Spanish, French and Simplified Chinese.                                                                                                                                                                                |
| **Not supported**     | No import of legacy binary notebook files. No authentication, permissions or end-to-end encryption. No audio notes, OCR, page templates or recycle-bin view. Page positions do not survive export to Word. Only a React binding so far. |

## Getting started

### 1. Install

```bash
npm install opennotes-react-viewer react
```

The binding is self-contained and installs [`ooxml-core`](https://www.npmjs.com/package/ooxml-core) and [`ooxml-ui`](https://www.npmjs.com/package/ooxml-ui) as regular dependencies.

### 2. Mount the notebook

```tsx
import { Notebook } from 'opennotes-react-viewer';

export function Notes() {
	return (
		<div style={{ height: '100vh' }}>
			<Notebook
				userName="Ada"
				storageName="ada-notes"
				onExport={(detail, event) => {
					event.preventDefault();
					save(detail.fileName, detail.bytes);
				}}
			/>
		</div>
	);
}
```

Or build your own UI over the raw hook (state in, plain actions out):

```tsx
const { client, state } = useNotebook({ user: { name: 'Ada' }, storageName: 'ada-notes' });
state?.pages.map((p) => <button onClick={() => client!.selectPage(p.id)}>{p.title}</button>);
```

<details>
<summary><strong>Plain markup</strong></summary>

Any framework, or none, can use the element straight from `ooxml-ui` (`npm install ooxml-ui`):

```ts
import { defineNotebookApp } from 'ooxml-ui/notebook';

defineNotebookApp();
```

```html
<notebook-app user-name="Ada" storage-name="ada-notes" theme="dark"></notebook-app>

<notebook-app
	user-name="Ada"
	server-config='{"mode":"server","syncUrl":"wss://notes.example.com/sync","token":"change-me"}'
></notebook-app>
```

</details>

| Binding | Component      | Raw hook                                                         |
| ------- | -------------- | ---------------------------------------------------------------- |
| React   | `<Notebook />` | `useNotebook(options)` (`useNotebookClient`, `useNotebookState`) |

See the [React guide](https://christophervr.github.io/ooxml/notebook/frameworks/react) and `demos/notebook/react/src/App.tsx` for both styles on one page.

## Packages

| Package                  | What it is                                        | Peer dependency |
| ------------------------ | ------------------------------------------------- | --------------- |
| `opennotes-react-viewer` | React 18+ component and hooks (`packages/react`). | `react`         |

The workspace also holds **private** packages that are never published: `notebook-viewer` (`packages/web-component`, the shared binding wiring, inlined into the binding at build time), the demo and the browser tests.

```
packages/web-component   re-exports ooxml-ui/notebook and adds bindNotebook / pickNotebookProps
packages/react           the React binding: <Notebook /> and the raw hooks
docs/                    the VitePress site and the GitHub Pages build
../../demos/notebook     the React demo (runs against this repository's source, hot reload)
../../e2e/notebook       the Playwright specs, run against the demo
```

## Development

Needs Node 22+ and Bun, in a checkout of this repository. The demo and the unit tests use the repository's own `ooxml-core` and `ooxml-ui` source; the typecheck reads their built declarations.

```bash
bun install                                   # at the repository root
bun run build && bun run --cwd src/ui build   # once, for the typecheck and the packages
cd viewers/notebook
bun run dev            # the React demo on http://127.0.0.1:5302
bun run typecheck
bun run test           # vitest (jsdom)
bun run test:browser   # Playwright against the demo (PLAYWRIGHT_PORT, default 5309)
bun run build:packages && bun run check:published && bun run pack:smoke:local
bun run build:pages    # the docs site and the demo, as deployed
```

The demo reads `?name=` (default `Ada`), `?locale=`, `?storage=` (the IndexedDB database, default `notebook-demo`) and `?theme=` (`system`, `light`, `dark`). Open `http://127.0.0.1:5302/?name=Ada` and, in another tab, `...?name=Bob`: two people in one notebook.

## Releasing

`opennotes-react-viewer` is released by this repository's automated flow from Conventional Commits, with its own version and tag (`opennotes-react-viewer@<version>`). See [docs/releasing.md](../../docs/releasing.md) and [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Documentation

[Getting started](https://christophervr.github.io/ooxml/notebook/getting-started) &middot; [Element API](https://christophervr.github.io/ooxml/notebook/api) &middot; [React](https://christophervr.github.io/ooxml/notebook/frameworks/react) &middot; [Architecture](https://christophervr.github.io/ooxml/notebook/architecture) &middot; [Limitations](https://christophervr.github.io/ooxml/notebook/limitations)

## Contributing and license

Contributions follow [CONTRIBUTING.md](../../CONTRIBUTING.md). [Apache License 2.0](LICENSE); see [`NOTICE`](NOTICE) for attributions.
