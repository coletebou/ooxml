# Limitations

OpenMail is an early implementation. This page lists what it does not do, so nothing is a surprise.

- **No live-server test yet.** The JMAP client is tested against the RFC examples and recorded
  responses, not a running server.
- **Contacts and the calendar are local** to the browser (the demo keeps them in memory; with a
  server they are kept in local storage). JMAP for contacts and calendars is not used yet. They are
  kept per server address, not per account: two accounts on one server in the same browser profile
  share them (as do all custom transports).
- **No invitations.** Calendar events import and export as iCalendar files, but meeting requests
  and replies (iTIP) are not handled.
- **iCalendar import is partial**: repeating rules the calendar cannot represent (an interval
  greater than one, several weekdays) import their first occurrence and say so.
- **Repeating events change as a whole series**: editing or deleting one occurrence changes them
  all. The event form offers the five repeat kinds (none, daily, weekly, monthly, yearly) and keeps
  an existing end or weekday rule. It has no reminders or attendees (an imported event keeps its
  attendees, unedited). Weeks start on Monday in every language.
- **Forwarding drops inline images**: pictures embedded in a message's HTML (`cid:` parts) are not
  carried into a forward; regular attachments are.
- **Threads are per folder**: a reply you sent shows in Sent, not inside the Inbox conversation.
- **Rich text** uses the browser's editing commands; it is tested in Chromium. Quoted and pasted
  HTML loses remote images, so composing never loads a tracker.
- **Unsaved drafts when the app goes away**: if the app is removed while a draft cannot be saved
  (offline, over quota), it keeps trying for about a minute; after that the unsaved edits are lost.
- **No rules, signatures, S/MIME or OpenPGP**, no `.msg` or `.pst` import, no offline cache of the
  mailbox.
- **One binding**: React. Vue, Angular, Svelte, Solid and vanilla follow.
- Attachment previews are read-only and show what the viewers support; layout may differ from the
  program that wrote the file.
