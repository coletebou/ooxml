# openmail-react-viewer

React binding for **OpenMail**, an open-source mail, calendar and contacts app that speaks JMAP. It
gives you the complete UI as a component **and** raw hooks to build your own.

[Source](https://github.com/ChristopherVR/ooxml/tree/main/viewers/mail) | [Documentation](https://christophervr.github.io/ooxml/mail/)

## Install

```bash
npm install openmail-react-viewer
```

`react` (18 or later) is a peer dependency. The `<mail-app>` element is bundled in; the logic comes
from [`ooxml-core`](https://www.npmjs.com/package/ooxml-core) and the elements from
[`ooxml-ui`](https://www.npmjs.com/package/ooxml-ui), installed as regular dependencies with `lit`.

## Use

```tsx
import { Mail } from 'openmail-react-viewer';

<Mail
	config={{ kind: 'jmap', url: 'https://mail.example.com', auth: { type: 'bearer', token } }}
	locale="de"
	onNotice={(notice) => console.log(notice)}
/>;
```

Or your own markup over the raw client (state in, plain actions out):

```tsx
import { useMail } from 'openmail-react-viewer';

const { client, state } = useMail({ config });
state?.conversations.map((c) => <button onClick={() => client?.open(c.id)}>{c.subject}</button>);
```

Without `config` the app opens an in-memory demo mailbox: nothing is sent anywhere.

## Honest limits

Early implementation: tested against the JMAP RFC examples with a mocked server, not yet against a
live one. Contacts and the calendar are kept in the browser. See the
[limitations](https://christophervr.github.io/ooxml/mail/limitations).

Apache-2.0.
