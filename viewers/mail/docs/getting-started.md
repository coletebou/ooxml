# Getting started

## Install

```bash
npm install openmail-react-viewer
```

> Not on npm yet: the first release of `openmail-react-viewer` is still to come. Until then, run it
> from this repository (`bun install` at the root, then `bun run dev` in `viewers/mail`).

`react` (18 or later) is a peer dependency. The `<mail-app>` element is bundled in; the mail logic
comes from [`ooxml-core`](https://www.npmjs.com/package/ooxml-core) (`ooxml-core/mail`) and the
elements from [`ooxml-ui`](https://www.npmjs.com/package/ooxml-ui) (`ooxml-ui/mail`), both
installed as regular dependencies, together with `lit`.

## Mount the app

Without a `config` the app opens the demo mailbox: messages, contacts and events in memory, nothing
sent anywhere. Give it a height.

```tsx
import { Mail } from 'openmail-react-viewer';

export function Inbox() {
	return (
		<div style={{ height: '100vh' }}>
			<Mail locale="de" theme="system" />
		</div>
	);
}
```

To use your own server, pass a JMAP connection (see [Connect a JMAP server](./jmap)):

```tsx
<Mail config={{ kind: 'jmap', url: 'https://mail.example.com', auth: { type: 'bearer', token } }} />
```

## Build your own UI

The raw hook gives you the client every binding wraps: one immutable state and plain actions.

```tsx
import { useMail } from 'openmail-react-viewer';

const { client, state } = useMail({ config });
state?.conversations.map((c) => (
	<button key={c.id} onClick={() => client?.open(c.id)}>
		{c.subject}
	</button>
));
```

Without React, use the element directly after `registerMail()` from `ooxml-ui/mail`, or
`createMail(options)` from the same entry for the raw client.

## Events

| Prop               | Event                  | When                                                          |
| ------------------ | ---------------------- | ------------------------------------------------------------- |
| `onReady`          | `mail-ready`           | The account is connected and the first folder has loaded.     |
| `onNotice`         | `mail-notice`          | Something happened: sent, moved, deleted, imported, an error. |
| `onOpenAttachment` | `mail-open-attachment` | An attachment is opened; cancel it to show the file yourself. |

## Keyboard

`c` new message, `/` search, `j`/`k` next and previous, `o` or Enter open, `x` select, `e` archive,
`#` or Delete delete, `!` junk, `s` flag, Shift+I and Shift+U read and unread, `r` reply, `a` reply
all, `f` forward, Ctrl+Enter send, Escape close, `?` all shortcuts.
