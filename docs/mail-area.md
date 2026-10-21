# The `mail` area (`ooxml-core/mail`)

The logic of an open-source mail, calendar and contacts application that sits beside Word, Excel,
PowerPoint, Visio and OpenTeams. It is **new code** (nothing moved here). DOM-free: the transport,
`fetch`, storage and timers are injectable. Calendar arithmetic and iCalendar live in the shared
`calendar` area (`ooxml-core/calendar`, see `docs/calendar-area.md`).

| Layer              | Where                                    | Owns                                                                    |
| ------------------ | ---------------------------------------- | ----------------------------------------------------------------------- |
| Logic              | `src/core/mail/` (this area)             | model, MIME and `.eml`, threading, search, compose rules, vCard, client |
| Elements           | `src/ui/src/mail/` (`ooxml-ui/mail`)     | `<mail-app>` and its parts, the HTML sanitiser, the dictionaries        |
| Bindings and demos | `viewers/mail`, `demos/mail`, `e2e/mail` | `openmail-react-viewer`, the React demo, the browser tests              |

## The client: one state, plain actions

```ts
import { createMailClient, createMemoryTransport, createDemoSeed } from 'ooxml-core/mail';

const mail = createMailClient({ transport: createMemoryTransport(createDemoSeed()) });
const stop = mail.subscribe(() => render(mail.getState())); // coalesced per tick
await mail.search('from:amara has:attachment');
```

`getState()` returns one immutable `MailState`: connection `status` and `error`, the `account`,
`identities` and `canSend`, the folder tree (`mailboxes`, special-use folders first), the open
`mailboxId`, the list (`conversations`, each with subject, participants, recipients, preview, date,
count, unread, flagged, attachment and draft flags; `total` on the server and `loaded`), the search
`query` and `searchScope`, `selection` and the list cursor `focusedId`, the `open` conversation with
the bodies loaded so far, the `compose` window (draft, status, last save, uploads) and the
`contacts` and calendar `events`. Every button is an action: `selectMailbox`, `search`,
`setSearchScope`, `setThreaded`, `loadMore`, `select`, `toggleSelected`, `selectRange`,
`selectAll`, `focus`, `focusNext`, `open`, `close`, `markRead`, `toggleRead`, `setFlagged`,
`toggleFlagged`, `moveTo`, `archive`, `markJunk`, `remove`, `createMailbox`, `renameMailbox`,
`deleteMailbox`, `compose` (new, reply, reply all, forward), `editDraft`, `updateDraft`, `attach`,
`detach`, `saveDraft`, `send`, `discardDraft`, `closeCompose`, `download`, `exportEml`,
`importEml`, `saveContact`, `deleteContact`, `importVCards`, `exportVCards`, `saveEvent`,
`deleteEvent`, `importIcs`, `exportIcs`, `destroy`. What just happened arrives through `onNotice`
(sent, moved with an `undo`, imported, a file still uploading, an error code); the UI words it.

Changes are applied to the list at once and put back if the server refuses them. Drafts are saved
a quiet moment after the last edit, never two saves at once, and a draft counts as saved only once
the server has its latest edit. A draft that cannot be saved, or whose attachments are still uploading, keeps its window open with its edits:
closing it, or opening another message, waits for a save that succeeds (`compose`, `editDraft` and
`closeCompose` resolve `false` otherwise). While a file is still uploading into it, the window does
not give way and its message is not sent either (`send` resolves `false`), and a warning notice
says so each time. Without a Trash folder, Delete reports `unsupported`
instead of destroying mail. Responses for a folder or search the person already left are dropped.

## Transports

`MailTransport` is the seam: `connect`, `mailboxes`, `createMailbox`, `renameMailbox`,
`destroyMailbox`, `query`, `summaries`, `message`, `update`, `destroy`, `saveDraft`, `send`,
`upload`, `download`, `importMessage`, `watch`, `close`. Failures are `MailTransportError` with a
`code` (`unauthorized`, `network`, `overQuota`, ...), never a sentence the UI has to parse. A send
the server did not confirm fails as `uncertain`, not as not sent: the message may have gone out,
and sending the same draft again first asks the server whether it did.

- `createMemoryTransport({ account, identities, mailboxes, messages, latencyMs, loopback })`: a mail
  server in memory for demos and tests; a message sent to your own address arrives in the Inbox.
- `createJmapTransport({ url, auth, fetch?, push? })`: JMAP (RFC 8620 core, RFC 8621 mail). Session
  discovery through `/.well-known/jmap`, bearer or basic auth, `Mailbox`, `Email`, `Thread`,
  `EmailSubmission` and `Identity`, back references, batching by the server's limits, state tracking
  with `*/changes`, push through the event source (read with `fetch` so the `Authorization` header
  is sent) or polling. A message read over JMAP shows the body and attachments the server lists
  (`textBody`, `htmlBody`, `attachments`), so an attached multipart shows as the server decides;
  `readEmail` lists each of its parts as a file (RFC 2183 section 2.9). Credentials are never
  logged, persisted, put in a URL or an error message. They and request bodies go over https only
  (plain http to a loopback host), redirects included: where the platform hands redirects back,
  every request checks each hop before following it and refuses one to plain http; a browser,
  which hides them, blocks that hop itself as mixed content. After an `uncertain` send it keeps
  the copy it made, in memory: the same draft sent again first asks the server whether that copy
  went out (RFC 8621 7.3), sends nothing while the server cannot be asked, and sends it again only
  when the server says it did not, or has neither the copy nor a submission of it any more. A
  reload forgets the copy, and a changed draft is a new message. A request the server refused as
  a whole (HTTP 4xx, RFC 8620 3.6) sent nothing and fails with its own error; one that creates
  and submits the message at once and gets no answer at all fails as that failure, with no copy
  known to ask about.

## Messages

- **MIME** (`mime/`): headers (unfolding, folding), RFC 5322 addresses and dates, RFC 2047 encoded
  words, RFC 2045 and RFC 2231 parameters, quoted-printable, base64, multipart, `message/rfc822`;
  `readEmail` classifies body parts as RFC 8621 section 4.1.4 does, `writeEmail` builds
  `multipart/alternative`, `related` and `mixed`. `.eml` import and export are these two
  (`eml.ts`). Malformed input never throws.
- **Threading** (`threading.ts`): the REFERENCES algorithm of RFC 5256 over `Message-ID`,
  `References` and `In-Reply-To`, then the base subject (`subject.ts`, RFC 5256 section 2.1 plus the
  common translated reply markers). Iterative throughout, so a chain thousands deep cannot overflow
  the stack; a test threads ten thousand messages into two thousand conversations.
- **Search** (`search.ts`): `parseSearch` reads `from:`, `to:`, `subject:`, `body:`,
  `has:attachment`, `is:unread`, `is:read`, `is:flagged`, `before:`, `after:` and free text; the
  memory transport matches with `matchesQuery`, the JMAP client sends an `Email/query` filter. An
  HTML body sent in several parts (`htmlParts`) is read part by part, for search as for previews.
- **Compose** (`compose.ts`): recipients of a reply and reply all (never yourself), `Re:` and `Fwd:`
  subjects, `In-Reply-To` and `References` (RFC 5322 section 3.6.4), quoting with words the UI
  supplies (`QuoteFormat`), so they are localised. The HTML a quote or a reopened draft holds comes
  from the client's `draftHtml` option: `ooxml-ui/mail` cleans each part of the body on its own, as
  the reading pane shows it, so a part that ends in an open comment or tag cannot take in the rest;
  without the option, a draft holds the HTML as sent.

## Contacts and calendar

`contacts.ts` is the address book model (every vCard structured component) and its helpers;
`vcard.ts` reads vCard 4.0, 3.0 and the common 2.1 forms and writes 4.0, keeping every property it
does not edit verbatim (an inline 3.0 or 2.1 photo, logo, sound or key is written as the 4.0 `data:`
URI, `vcard-legacy.ts`). A card without a UID gets an id from a hash of its content, the same
wherever it stands in a file, and two copies of it are one contact. `record-store.ts` keeps
contacts and events in memory, optionally persisted to a `Storage`-like object and re-validated
when read back. `calendar-store.ts` stores the shared `CalendarEvent`.

## Demo data

`createDemoSeed({ now, zone, bulk, files })` builds the demo mailbox: fictional people at reserved
example domains (RFC 2606), conversations with replies, an HTML newsletter with remote images and a
script (to show the sanitiser), an inline `cid:` image, a draft, junk, contacts and a week of
events, identical on every run. `bulk` adds older messages to try the list with thousands; `files`
supplies Office documents for the attachments.

## Honest limits

- The JMAP client is tested against the RFC examples and recorded responses with a mocked `fetch`,
  not yet against a live server.
- Contacts and the calendar are local (JMAP for contacts and calendars is not used yet); no iTIP
  invitations.
- Threads are built from the messages of the open folder (or search), not across folders.
- No rules, signatures, S/MIME or OpenPGP; `.msg` and `.pst` belong with `ole2` and are not read.
