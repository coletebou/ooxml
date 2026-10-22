# Limitations

OpenNotes is an early implementation. This page lists what it does not do, so you can decide
before you rely on it.

## An independent notebook app

OpenNotes is not a replacement for any commercial notebook app, is not affiliated with one and
makes no claim of feature parity. It implements:

- notebooks, section groups, sections with colours, and pages with two levels of subpages;
- free-form pages: text containers placed anywhere, pictures, embedded files and ink, moved by a
  grip and resized from a corner;
- rich text: bold, italic, underline, strikethrough, highlight, three heading levels, bullet and
  numbered lists, links and to-do tags, with Markdown-style shortcuts (`* `, `1. `, `# `, `[] `);
- pen and highlighter ink, and an eraser that removes whole strokes;
- search across page titles and text, and a To Do pane over the whole notebook;
- export of a page to a Word document, and export and import of a notebook archive;
- real-time collaboration with presence, between tabs or through your own sync server.

It does **not** implement audio or video notes, OCR or handwriting recognition, page templates,
tags other than to-dos, sharing permissions, a recycle-bin view, or an account-level list of
notebooks.

## Files and formats

- **No import of legacy binary notebook files.** The binary formats of other notebook apps are
  not read. What OpenNotes opens and writes is its own notebook archive (a zip with
  `notebook.json` and the media) and, one way, a page exported to `.docx`.
- **Page export to Word is a flowing document.** Page positions do not survive; containers are
  written in reading order (top to bottom, then left to right). Ink becomes one picture, not
  editable ink. Pictures Word cannot show (WebP, SVG) are converted when the browser can draw
  them; anything that still cannot be exported is reported (a notice says how many items were
  left out), never dropped silently.
- **Embedded Office files are read-only previews.** Word, Excel, PowerPoint and Visio files are
  shown live by the suite's viewers; editing one is up to your app (the `notebook-open-file`
  event), and a changed file has to be inserted again.
- Pictures and files are limited to 32 MiB each.

## Storage

- **Notebooks live in this browser.** They are kept in IndexedDB under `storageName`, per browser
  profile and site. Clearing the site's data deletes them; there is no cloud copy. Export an
  archive to keep one.
- Without IndexedDB (blocked storage, some private windows) the app works in memory only, and
  nothing survives a reload.
- Deleted notebooks are purged from the device's list after a week. Deleted sections and pages
  are restored through the Undo of the notice that follows the delete; there is no recycle-bin
  view yet.
- The bytes of deleted pictures and files stay in the notebook's document (so undo can bring them
  back) and are not garbage-collected; an archive export carries only what is still used.

## Collaboration and security

- **No authentication or permissions.** Anyone who can reach a notebook's room can read and edit
  it. A server `token` is one shared secret, not per-user access control; authorization is your
  server's job.
- **No end-to-end encryption.** In server mode the sync server receives and can store every
  change.
- **Presence is advisory and unauthenticated**, like any Yjs awareness: a client can claim any
  name.
- Undo covers your own edits only, never a collaborator's.
- A page title is one value: two people retitling a page at once keep one of the titles. Text
  inside containers merges per character.
- Local mode uses `BroadcastChannel`, so only tabs of the same browser on the same site see each
  other.

## Bindings

Only React has a binding so far (`opennotes-react-viewer`). Other frameworks can use the
`<notebook-app>` element from `ooxml-ui/notebook` directly until their bindings exist.
