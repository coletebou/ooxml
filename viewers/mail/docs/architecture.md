# Architecture

| Layer               | Where                                    | Owns                                                                        |
| ------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| Logic               | `ooxml-core/mail` (`src/core/mail`)      | model, MIME and `.eml`, threading, search, compose rules, vCard, the client |
| Calendar arithmetic | `ooxml-core/calendar`                    | zones, repeats, day/week/month views, iCalendar read and write              |
| Elements            | `ooxml-ui/mail` (`src/ui/src/mail`)      | `<mail-app>` and its parts, the sanitiser, the dictionaries                 |
| Bindings and demos  | `viewers/mail`, `demos/mail`, `e2e/mail` | `openmail-react-viewer`, the React demo, the browser tests                  |

## State in, actions out

`createMailClient({ transport })` returns `getState()`, `subscribe()` and actions (`selectMailbox`,
`open`, `markRead`, `moveTo`, `archive`, `compose`, `send`, `search`, ...). The UI never talks to a
server: it renders the state and calls actions. That is the surface every binding's raw hook wraps.

## Transports

A `MailTransport` is the seam to a server: `connect`, `mailboxes`, `query`, `summaries`, `message`,
`update`, `destroy`, `saveDraft`, `send`, `upload`, `download`, `importMessage`, `watch`. Two ship:
`createMemoryTransport()` (demos and tests) and `createJmapTransport()`. Others (an IMAP bridge,
other web APIs) can be added without touching the client or the UI.

## Threading

The list threads messages itself with the REFERENCES algorithm of RFC 5256: `Message-ID`,
`References` and `In-Reply-To` first, then the base subject (reply and forward markers removed). It
is iterative, so a reply chain thousands deep is fine, and the list renders only the rows in view.

## Reading HTML mail

Message HTML is untrusted. It is sanitised with DOMPurify (no scripts, forms, frames, event
handlers or `javascript:` links; remote images, backgrounds and CSS blocked and counted) and then
shown in an `<iframe>` sandbox without `allow-scripts`, with a Content-Security-Policy that blocks
remote loads until the person chooses "Show images". Links open in a new tab without an opener.
