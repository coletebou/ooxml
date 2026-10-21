# AGENTS.md

Guidance for coding agents (Claude Code, Codex, and others) working in this viewer. This file is
canonical: `CLAUDE.md` only imports it, so edit this file and never fork the two. Read the root
`AGENTS.md` first; its rules apply here.

## READ FIRST: this folder is bindings, demos and docs

All mail **logic** lives in the `mail` area of `ooxml-core` (`src/core/mail`, documented in
`docs/mail-area.md`): the message model, MIME and `.eml`, RFC 5256 threading, search, compose
rules, vCard, the `createMailClient` store, the `MailTransport` seam with the memory transport and
the JMAP client. Calendar arithmetic and iCalendar are the shared `calendar` area. The **elements**
(`<mail-app>`, the folder pane, message list, reading pane, compose, calendar and contacts panes,
the sanitiser and the dictionaries) live in `ooxml-ui/mail` (`src/ui/src/mail`). This folder holds:

- `packages/web-component`: a re-export of `ooxml-ui/mail` plus the binding helper `bindMail` (the
  private workspace package `mail-viewer`, never published, inlined into every binding).
- `packages/react`: the thin React binding, published as `openmail-react-viewer`: the `<Mail />`
  component and the raw hooks `useMail`, `useMailClient`, `useMailState`. Vue, Angular, Svelte,
  Solid and vanilla follow the same shape once the element API settles.
- `demos/mail/` at the repository root: the React demo on the in-memory demo mailbox.
- `e2e/mail/` at the repository root: the browser tests (`bun run test:browser`, config here).
- `docs/`: the VitePress site published under `/ooxml/mail/`.

The product name is **OpenMail**. The plain `openmail` npm name belongs to someone else, so never
publish or document that name. Never name another mail program or its vendor in UI copy.

## How the code is written

- **Bindings are lifecycle adapters.** A component binding creates `<mail-app>`, forwards props with
  `bindMail`/`pickMailProps` (over `applyMailProps` and `listenMailEvents` in ooxml-ui) and
  re-emits events. Each binding also exposes the raw hook over `createMail`. A behaviour bug is
  fixed once, in ooxml-ui or the core; a hook or wiring bug in every binding in the same change.
- **State in, actions out.** UI reads `MailState` and calls client actions; it never talks to a
  server directly.
- **Message HTML is untrusted.** It goes through the sanitiser and the sandboxed frame; never put a
  message's markup anywhere else. Text a sender wrote is rendered as text.
- **Credentials** are never logged, persisted or put in a URL.

## Commands

```bash
bun install
bun run dev            # the React demo on http://127.0.0.1:5311/
bun run typecheck
bun run test           # vitest (jsdom)
bun run test:scripts   # the publish guard
bun run build:packages # dist/ for the React binding (web component inlined)
bun run check:published
bun run test:browser   # Playwright against the React demo (PLAYWRIGHT_PORT, default 4192)
bun install --cwd docs && bun run build:pages
```

## Releases

`openmail-react-viewer` is released by the repository's release flow (`scripts/viewer-packages.mjs`).
Its first publish needs a maintainer once, like every new package name (`docs/releasing.md`). Never
run `npm publish` by hand, never edit versions or `CHANGELOG.md` files, never add `file:` or
`workspace:` ranges or a `mail-viewer` dependency to a published manifest.

## Style

TypeScript strict, tabs, single quotes, no em-dashes anywhere. Conventional Commits with the area as
scope (`mail`, `ui`, `docs`, `ci`).
