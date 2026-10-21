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

## What is not proven yet

The client is tested against the worked examples of RFC 8620 and RFC 8621 and recorded responses
with a mocked `fetch`. It has not yet been run against a live server; server-specific behaviour
(push quirks, limits, error wording) may need adjustments.
