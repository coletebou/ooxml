# AGENTS.md

Guidance for coding agents (Claude Code, Codex, and others) working on the notebook viewer. This
file is canonical: `CLAUDE.md` only imports it, so edit this file and never fork the two. The
repository's root `AGENTS.md` applies too; read it first.

## READ FIRST: this folder is bindings, a demo and docs

All notebook **logic** lives in the `notebook` area of `ooxml-core` (`src/core/notebook`,
documented in `docs/notebook-area.md`): the model, the Yjs schema, structure and canvas commands,
search, to-dos, export and archives, sync, and the `createNotebookClient` store. The editor
without a view (ProseMirror schema, commands, keymap, input rules) is `ooxml-core/notebook/editor`.
The **app** is `<notebook-app>` in `ooxml-ui` (`src/ui/src/notebook`, published as
`ooxml-ui/notebook`): the navigation pane, page canvas, ink layer, file embeds, To Do pane, ribbon,
IndexedDB storage and translations, plus the binding contract (`applyNotebookProps`,
`listenNotebookEvents`) and the raw-hook factory `createNotebook`. This folder holds:

- `packages/web-component`: the private workspace package `notebook-viewer` (never published,
  inlined into every binding). It re-exports `ooxml-ui/notebook` and adds `bindNotebook` and
  `pickNotebookProps` (`src/bind.ts`), the wiring every binding shares.
- `packages/react`: the React binding, published as `opennotes-react-viewer`. Other frameworks
  come later, as `packages/<framework>` published as `opennotes-<framework>-viewer`.
- `docs/`: the VitePress site (`https://christophervr.github.io/ooxml/notebook/`), English only.
- `demos/notebook/` at the repository root: the React demo (a private workspace package).
- `e2e/notebook/` at the repository root: the Playwright specs (`bun run test:browser`, config in
  this folder), run against the React demo. Each spec isolates its notebooks with `?storage=`.

The product name is **OpenNotes** and the packages are `opennotes-*`. Never add or fork
logic here that belongs in the core or in `ooxml-ui`: if one lacks something, change it there,
then use it here.

## The element API

`<notebook-app>` takes `user-name`, `user-id`, `storage-name`, `theme` (`system`, `light`,
`dark`), `server-config` (JSON) and `locale` as attributes, and `config` as a property. It emits
four bubbling, composed events: `notebook-ready` (`{ user }`), `notebook-navigate`
(`{ notebookId, sectionId, pageId }`), and the cancelable `notebook-open-file`
(`{ id, name, mime, kind, bytes }`, `id` the container) and `notebook-export` (`{ fileName, mime, bytes, kind }`), whose
default is a download. The props every binding forwards are `NotebookProps` in `ooxml-ui`'s
`notebook/bind.ts`; `pickNotebookProps` copies exactly its data props, and a test fails when a
new one is not picked.

## How the code is written

- **Bindings are lifecycle adapters.** A component binding creates `<notebook-app>`, forwards
  props and the host class with `bindNotebook`/`pickNotebookProps` and re-emits events through
  it, nothing more. Apply props before the element's first update (React: a layout effect), or
  the element starts a client on the default storage first. Each binding also exposes the **raw
  hook** over `createNotebook` (React `useNotebook`, `useNotebookClient`, `useNotebookState`).
  A behaviour bug is fixed once, in `ooxml-ui` or the core; a hook or wiring bug is fixed in every
  binding in the same change.
- **State in, actions out.** UI reads `NotebookState` and calls client actions; it never touches
  Yjs, IndexedDB or the network directly.
- **Declare what you import.** The workspace uses Bun's isolated linker; each package (the demo,
  the e2e package, the bindings) lists its own dependencies.

## Commands

```bash
bun install            # at the repository root: one workspace, one lockfile
bun run dev            # the React demo on http://127.0.0.1:5302
bun run typecheck      # strict; needs src/core and src/ui built (bun run build, bun run --cwd src/ui build)
bun run test           # vitest (jsdom), against the repository's ooxml-core and ooxml-ui source
bun run test:scripts   # the publish guards' own tests
bun run test:browser   # Playwright against the React demo (PLAYWRIGHT_PORT, default 5309)
bun run build:packages # dist/ for the bindings (the web component inlined)
bun run check:published && bun run pack:smoke:local   # what the tarballs import; install and import them
bun run docs:dev       # the docs site with hot reload; build:pages builds it with the demo
```

Without the bundled Chromium (`bun x playwright install chromium`), point the browser tests at an
installed Chrome with `PLAYWRIGHT_CHROMIUM_EXECUTABLE=<path to its binary>`.

`pack:smoke` installs `ooxml-core` and `ooxml-ui` from npm, as a consumer gets them, so it fails
(saying so) until a release of them has the `notebook` subpaths. `pack:smoke:local`
(`NOTEBOOK_SMOKE_LOCAL_OOXML=1`) packs the workspace's built `src/core` and `src/ui` and installs
them with the binding instead; CI runs that one, because the release publishes the binding against
exactly those versions.

## Releases

`opennotes-react-viewer` is released by the repository's own flow (`scripts/viewer-packages.mjs`,
`scripts/release-plan.mjs`): its own version and tag `opennotes-react-viewer@<version>`, and
a change to `packages/web-component`, `scripts/build-packages.mjs` or `tsconfig.release.json`
releases it too. A package that was never published goes out at its manifest version; npm trusted
publishing cannot create a package, so the first publish of a new name is a maintainer's manual
bootstrap (`docs/releasing.md`). Never run `npm publish`, bump versions or edit `CHANGELOG.md`
files by hand, and never add `file:` or `workspace:` ranges, or a `notebook-viewer` dependency, to
a published manifest (`check:published` and `pack:smoke` fail on them).

## Honesty

Report unsupported features honestly. OpenNotes is an independent project, not a replacement
for any commercial notebook app. It does not import legacy binary notebook files, it is local
first (notebooks live in the browser's IndexedDB), and collaboration goes through the `collab`
area's Yjs sessions (`BroadcastChannel` between tabs, or a y-websocket server). There is no
authentication and no end-to-end encryption; do not write copy or docs that imply otherwise.
`docs/limitations.md` is the list.

## Style and commits

TypeScript strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), tabs, single quotes,
`oxfmt`. **No em-dashes** (U+2014) anywhere. Commits follow Conventional Commits with the
`notebook` scope (see the root `AGENTS.md`); trunk-based, commit to `main`.
