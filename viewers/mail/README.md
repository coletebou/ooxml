<div align="center">

# OpenMail

**An open-source mail, calendar and contacts app: one web component that speaks JMAP to your own server, with a React binding.**
An early implementation, not affiliated with any mail provider.

[**Live demo**](https://christophervr.github.io/ooxml/mail/demo-react/) &nbsp;&middot;&nbsp;
[**Documentation**](https://christophervr.github.io/ooxml/mail/) &nbsp;&middot;&nbsp;
[**Getting started**](#getting-started)

Part of [ooxml](https://github.com/ChristopherVR/ooxml#readme): [Word](https://github.com/ChristopherVR/ooxml/tree/main/viewers/docx#readme) &middot; [Excel](https://github.com/ChristopherVR/ooxml/tree/main/viewers/xlsx#readme) &middot; [PowerPoint](https://github.com/ChristopherVR/ooxml/tree/main/viewers/pptx#readme) &middot; [Visio](https://github.com/ChristopherVR/ooxml/tree/main/viewers/visio#readme) &middot; [OpenTeams](https://github.com/ChristopherVR/ooxml/tree/main/viewers/teams#readme) &middot; **OpenMail** &middot; [Core](https://github.com/ChristopherVR/ooxml/tree/main/src/core#readme)

</div>

## Why OpenMail?

- **Standard servers.** JMAP ([RFC 8620](https://www.rfc-editor.org/rfc/rfc8620), [RFC 8621](https://www.rfc-editor.org/rfc/rfc8621)) straight from the browser. The transport is pluggable; an in-memory one runs the demo and the tests.
- **Safe reading.** HTML mail is sanitised and shown in a sandboxed frame with no scripts and a Content-Security-Policy; remote images stay blocked until you allow them.
- **Office attachments** open in the suite's own Word, Excel, PowerPoint and Visio viewers.
- **Logic in one place.** The mail logic is [`ooxml-core/mail`](https://github.com/ChristopherVR/ooxml/blob/main/docs/mail-area.md), the elements `ooxml-ui/mail`. This folder holds the bindings, the demo and the docs.

## Features and limitations

|                       |                                                                                                                                                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mail**              | Folders (Inbox, Drafts, Sent, Archive, Junk, Trash and your own), a threaded list (RFC 5256) that stays fast with thousands of messages, read and unread, flags, move, delete with Undo, multi-select, drag to a folder, keyboard shortcuts. |
| **Reading**           | Plain text with links, sanitised HTML in a sandboxed frame, remote images blocked until allowed, attachments with preview and download, `.eml` export.                                                                                       |
| **Writing**           | New, reply, reply all and forward with quoting; rich text; attachments; drafts saved automatically; address suggestions from your contacts.                                                                                                  |
| **Search**            | `from:`, `to:`, `subject:`, `body:`, `has:attachment`, `is:unread`, `is:flagged`, `before:`, `after:` and free text, in a folder or everywhere.                                                                                              |
| **Calendar**          | Day, week and month views, events with repeats, iCalendar import and export.                                                                                                                                                                 |
| **Contacts**          | List, edit, vCard (RFC 6350) import and export.                                                                                                                                                                                              |
| **Not supported yet** | A test against a live server; JMAP contacts and calendars (both are local today); invitations (iTIP); rules, signatures, S/MIME and OpenPGP; `.msg` and `.pst`; bindings other than React. See [limitations](docs/limitations.md).           |

## Getting started

```bash
npm install openmail-react-viewer
```

> Not on npm yet: the first release of `openmail-react-viewer` is still to come. Until then, run it
> from this repository (`bun install` at the root, then `bun run dev` in `viewers/mail`).

```tsx
import { Mail } from 'openmail-react-viewer';

<Mail
	config={{ kind: 'jmap', url: 'https://mail.example.com', auth: { type: 'bearer', token } }}
/>;
```

Without `config` the app opens the in-memory demo mailbox. The raw hook (`useMail`) gives you the
client to build your own UI. See [getting started](docs/getting-started.md) and
[connect a JMAP server](docs/jmap.md).

## Development

```bash
bun install
bun run dev            # the React demo on http://127.0.0.1:5311/ (?bulk=5000 for thousands of messages)
bun run typecheck && bun run test
bun run test:browser   # Playwright against the demo
```

## Contributing and license

Contributions follow [CONTRIBUTING.md](../../CONTRIBUTING.md). [Apache License 2.0](LICENSE); see [`NOTICE`](NOTICE).
