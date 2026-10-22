# Limitations

OpenMail is an early implementation. This page lists what it does not do, so nothing is a surprise.

- **No live-server test yet.** The JMAP client is tested against the RFC examples and recorded
  responses, not a running server.
- **Contacts and the calendar are local** to the browser (the demo keeps them in memory; with a
  server they are kept in local storage). JMAP for contacts and calendars is not used yet. They are
  kept per server address, not per account: two accounts on one server in the same browser profile
  share them (as do all custom transports). When local storage is full, a change or an import is
  kept only until the page is closed, and a notice says so; once there is room again, the next
  change stores them all. When the browser does not let the page use local storage at all (it is
  turned off, or the page is in a frame that may not use it), contacts and the calendar are kept
  only until the page is closed, and a notice says so at each change.
- **No invitations.** Calendar events import and export as iCalendar files, but meeting requests
  and replies (iTIP) are not handled.
- **iCalendar import is partial**: repeating rules the calendar cannot represent (an interval
  greater than one, several weekdays) import their first occurrence and say so.
- **Repeating events change as a whole series**: editing or deleting one occurrence changes them
  all. The event form offers the five repeat kinds (none, daily, weekly, monthly, yearly) and keeps
  an existing end or weekday rule. It has no reminders or attendees (an imported event keeps its
  attendees, unedited). Weeks start on Monday in every language.
- **Replies quote without inline pictures**: the pictures a message's HTML shows in place (`cid:`
  parts) are left out of a reply's quote. Forwards and reopened drafts keep them.
- **Threads are per folder**: a reply you sent shows in Sent, not inside the Inbox conversation.
- **Rich text** uses the browser's editing commands; it is tested in Chromium. Quoted, pasted and
  dropped HTML, and a saved draft opened again, lose remote images (so composing never loads a
  tracker), style sheets (inline styles stay) and the styling of the message's own body, such as
  its background (its direction and language stay): what is sent is what the editor shows.
- **A send the server did not confirm** (it failed part way, said nothing of the submission, or
  sent no answer at all) is reported as possibly sent. Sent again unchanged from the same open app,
  saved meanwhile or not, the message is first checked with the server and goes out again only if
  the server shows no sign that it went out: every submission of it was canceled, or there is none
  and its copy is still a draft (a server may drop the record of a submission, and the change that
  files the copy as sent can fail on its own, so this can be wrong); while the server cannot be
  reached, nothing is sent. After a reload, or once the message is changed, it is a new message,
  and so is one whose copy was deleted meanwhile; a saved draft opened again is read back from the
  server, and is the same message only if it reads back exactly as it was. After a send that got
  no answer at all, the copy is looked for by the message's Message-ID: a server that cannot
  search messages by header field cannot say whether it went out, and it is sent again, so look in
  Sent first.
- **Unsaved drafts when the app goes away**: if the app is removed, or connects to another mailbox,
  while a draft cannot be saved (offline, over quota), it keeps trying in the background (after 5,
  15 and 40 seconds, then once a minute) until the draft is saved; closing the page before then
  loses the unsaved edits.
- **No rules, signatures, S/MIME or OpenPGP**, no `.msg` or `.pst` import, no offline cache of the
  mailbox.
- **One binding**: React. Vue, Angular, Svelte, Solid and vanilla follow.
- Attachment previews are read-only and show what the viewers support; layout may differ from the
  program that wrote the file.
