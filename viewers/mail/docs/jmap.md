# Connect a JMAP server

OpenMail talks to the server directly from the browser over JMAP: [RFC 8620](https://www.rfc-editor.org/rfc/rfc8620)
(the core protocol) and [RFC 8621](https://www.rfc-editor.org/rfc/rfc8621) (mail).

```ts
const config = {
	kind: 'jmap',
	// The server origin (the client discovers the session at /.well-known/jmap) or the session URL.
	url: 'https://mail.example.com',
	auth: { type: 'bearer', token: '...' }, // or { type: 'basic', username, password }
};
```

What the client does:

- **Session discovery** through `/.well-known/jmap`, relative URLs resolved, the session refetched
  when a response says its state changed.
- **Mailboxes, email, threads, identities and submission**: `Mailbox/get` and `/set`, `Email/query`,
  `/get`, `/set` and `/import`, `EmailSubmission/set` with `onSuccessUpdateEmail` (the sent message
  moves to Sent in the same request), `Identity/get`, blob upload and download, with back
  references between calls and batching by the server's limits.
- **Changes**: `Mailbox/changes` and `Email/changes` from the last known states, and push through the
  server's event source when it offers one (read with `fetch`, so the `Authorization` header is
  sent), else polling.
- **Search** goes to the server as an `Email/query` filter: `from:`, `to:`, `subject:`, `body:`,
  `has:attachment`, `is:unread`, `is:flagged`, `before:` and `after:`, and free text.

## Browser requirements

The server must allow your page's origin (CORS) for the session, API, upload, download and event
source URLs. Use HTTPS.

## Credentials

The token or password lives only in the connection object you pass. OpenMail never writes it to
storage, never puts it in a URL and never includes it in an error message or a log. Keeping it
across visits (and how) is the host page's decision.

A token that expires can be given as a function that returns the current one (it may be async).
OpenMail asks it before each request, so a token refreshed meanwhile goes with the next request
and nothing connects again: the open conversation and the draft being written stay. Give the same
function each time (in React, keep it stable, for example with `useCallback`). A new token or a new
function is a new connection: it starts again from the server's folders, and the draft that was
open is saved with the credentials it was written under, which fails if they have expired.

```ts
let token = await signIn();
const config = {
	kind: 'jmap',
	url: 'https://mail.example.com',
	auth: { type: 'bearer', token: () => token },
};
// Later, once the token is refreshed, the next request sends the new one:
token = await refreshToken();
```

A function that throws, or gives no text, fails the request as `unauthorized` without sending it;
what it threw is not passed on, as it may quote what the token is refreshed with.

## What is not proven yet

The client is tested against the worked examples of RFC 8620 and RFC 8621 and recorded responses
with a mocked `fetch`. It has not yet been run against a live server; server-specific behaviour
(push quirks, limits, error wording) may need adjustments.
