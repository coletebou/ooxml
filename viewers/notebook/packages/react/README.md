# opennotebook-react-viewer

React binding for **OpenNotebook**, an open-source, local-first notebook app: notebooks, sections
and pages, each page a free-form canvas of rich text, pictures, embedded Office files and ink,
synced between tabs or through your own y-websocket server. It gives you the complete app as a
component **and** raw hooks to build your own UI.

[Source](https://github.com/ChristopherVR/ooxml/tree/main/viewers/notebook) | [Documentation](https://christophervr.github.io/ooxml/notebook/) | [Live demo](https://christophervr.github.io/ooxml/notebook/demo/)

Part of [ooxml](https://github.com/ChristopherVR/ooxml#readme): [Office](https://github.com/ChristopherVR/ooxml#ooxml-office-the-whole-suite-in-one-app) &middot; [Word](https://github.com/ChristopherVR/ooxml/tree/main/viewers/docx#readme) &middot; [Excel](https://github.com/ChristopherVR/ooxml/tree/main/viewers/xlsx#readme) &middot; [PowerPoint](https://github.com/ChristopherVR/ooxml/tree/main/viewers/pptx#readme) &middot; [Visio](https://github.com/ChristopherVR/ooxml/tree/main/viewers/visio#readme) &middot; [OpenTeams](https://github.com/ChristopherVR/ooxml/tree/main/viewers/teams#readme) &middot; **[OpenNotebook](https://github.com/ChristopherVR/ooxml/tree/main/viewers/notebook#readme)** &middot; [Core](https://github.com/ChristopherVR/ooxml/tree/main/src/core#readme)

## Install

```bash
npm install opennotebook-react-viewer
```

`react` (18 or later) is a peer dependency. The binding's wiring is bundled in; the notebook logic
comes from [`ooxml-core`](https://www.npmjs.com/package/ooxml-core) (`ooxml-core/notebook`) and the
`<notebook-app>` element from [`ooxml-ui`](https://www.npmjs.com/package/ooxml-ui)
(`ooxml-ui/notebook`), both installed as regular dependencies, together with `lit`.

## Use

The full app (give its parent a height):

```tsx
import { Notebook } from 'opennotebook-react-viewer';

<Notebook
	userName="Ada"
	storageName="ada-notes"
	onOpenFile={(detail, event) => {
		event.preventDefault();
		openElsewhere(detail.name, detail.bytes);
	}}
/>;
```

Or your own markup over the raw client (state in, plain actions out):

```tsx
import { useNotebook } from 'opennotebook-react-viewer';

const { client, state } = useNotebook({ user: { name: 'Ada' }, storageName: 'ada-notes' });
state?.pages.map((p) => <button onClick={() => client?.selectPage(p.id)}>{p.title}</button>);
```

Notebooks are stored in the browser's IndexedDB (the `storageName` database), and tabs of one
browser share them over `BroadcastChannel`. For people on other machines, pass
`config={{ mode: 'server', syncUrl: 'wss://notes.example.com/sync' }}`: any y-websocket server
works.

## Honest limits

OpenNotebook is an independent project, not a replacement for any commercial notebook app. It
does not import legacy binary notebook files. There is **no authentication and no end-to-end
encryption**: anyone who reaches a notebook's room can edit it, and a sync server can read it. See
the [limitations](https://christophervr.github.io/ooxml/notebook/limitations).

Licence: Apache-2.0.
