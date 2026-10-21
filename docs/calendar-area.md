# The `calendar` area (`ooxml-core/calendar`)

The format-neutral calendar logic every product shares: zone arithmetic on instants, repeating
series with cancelled and changed occurrences, occurrence expansion, the days a calendar view shows
(day, work week, week, month) and the layout of a day, and iCalendar (RFC 5545) export and import.
DOM-free, no storage and no clock (callers pass `now`). Zone data comes from the platform's `Intl`,
so no time-zone database is bundled. The `teams` area stores meetings in its workspace document and
does all their calendar arithmetic here (its `ooxml-core/teams` exports are unchanged: `Occurrence`
there names a `meetingId`), and a mail or calendar product reads and writes `.ics` files with it.
The area never imports `teams`.

## Model (`model.ts`)

- `RecurringSeries`: what recurrence reads. `start` and `end` are UTC milliseconds, `zone` is the
  IANA zone a repeat keeps its wall-clock time in, `repeat` is `none`, `daily`, `weekly`, `monthly`
  or `yearly`, `monthlyBy` (`date`, the default, or `weekday` with an `ordinal` of 1 to 4 or -1 for
  the last), and an end of `count` occurrences or an `until` instant (an occurrence that starts on
  it still happens), never both.
- `EventException`: one occurrence cancelled or changed (new `start`/`end`, `title`,
  `description`), keyed by its `originalStart` (iCalendar RECURRENCE-ID). `OccurrencePatch` is what a
  change may set.
- `CalendarEvent extends RecurringSeries`: `id`, `title`, `description`, and optional `location`,
  `allDay`, `exceptions`, `cancelled`, `reminder` (minutes before each start), `organizer` and
  `attendees` (`EventPerson`: a name and an address; an `EventAttendee` adds a `response` and
  `optional`), and `uid` (the iCalendar UID an import read, written back unchanged). A team
  meeting is assignable to it as it is.
- An all-day event starts at the start of its first day and ends at the start of the day after its
  last one, both in `zone` (iCalendar `VALUE=DATE`, the end exclusive). It may span several days, a
  repeat keeps it on whole days (23 or 25 hours across a clock change), and its occurrences carry
  the `dates` they cover, so a view shows it on those dates in any viewer zone.

## API

| Module            | Names                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `time-zone.ts`    | `zonedParts`, `zonedToUtc`, `offsetMinutes`, `startOfDay`, `addDays`, `dayKey`, `minuteOfDay`, `isValidZone`, `localZone`, `MINUTE_MS`, `HOUR_MS`, `DAY_MS`              |
| `recurrence*.ts`  | `seriesStart`, `seriesBetween`, `seriesIndexOf`, `withinSeries`, `calendarSlots`, `slotAt`, `slotStart`, `repeatChoices`, `nthWeekdayOfMonth`, `daysInMonth`, ...        |
| `occurrences.ts`  | `occurrencesBetween(event, from, to)`, `occurrenceAt(event, start)`, `occurrenceEnd(event, start)`, `dueOccurrences(events, now, lead?)`, `REMINDER_LEAD_MS`             |
| `views.ts`        | `viewDays(anchor, mode, zone, weekStartsOn?)`, `shiftAnchor(anchor, mode, direction, zone)`, `addMonths`, `monthGrid(anchor, zone, weekStartsOn?)`, `eventsByDay(...)`   |
| `layout.ts`       | `layoutDay(occurrences, day, zone)`: minutes after midnight and side-by-side columns for overlapping timed occurrences                                                   |
| `ics-write.ts`    | `eventsToIcs(events, { prodId, uidDomain, now?, method?, organizer?, attendees? })`, `icsRecurrence`, `icsUtc`, `icsLocal`, `icsDateTime`, `icsDate`, `icsDuration`, ... |
| `ics-timezone.ts` | `vtimezoneLines(zone, firstYear)`, `zoneTransitions(zone, year)`                                                                                                         |
| `ics-read.ts`     | `parseIcs(text, { zone?, uidDomain?, taken?, stored? }): { events, unsupported }`                                                                                        |
| `ics-lines.ts`    | `unfoldLines`, `parseContentLine`, `unescapeText`, `readComponents`: the content-line reader (vCard uses the same line format)                                           |

`CalendarMode` is `workweek`, `week`, `day` or `month`. `monthGrid` always returns six weeks of
seven `MonthDay`s (a `CalendarDay` with `inMonth`), so a month view keeps its height; `shiftAnchor`
steps a month view by a month, keeping the day of the month or the month's last day (31 January
steps to 28 or 29 February). `eventsByDay(occurrences, days, zone)` returns a map from each day's
`start` to the occurrences that touch it: all-day ones first, then by start, a multi-day one on
every day it touches.

## iCalendar

`eventsToIcs` writes one VCALENDAR: a VTIMEZONE for each zone a timed event uses, then each event
with its RRULE, EXDATEs and a RECURRENCE-ID event per changed occurrence (as `meetingToIcs` does
for a meeting), LOCATION, ORGANIZER and ATTENDEE (only people with an address), STATUS and a VALARM
for the reminder. All-day events are written as dates. DTEND is written only when it is after
DTSTART (RFC 5545): without it a timed event ends where it starts and an all-day one lasts its day.

`parseIcs` never throws. It reads every VEVENT: UID, SUMMARY, DESCRIPTION, LOCATION, DTSTART with
DTEND or DURATION (UTC times; floating times and all-day dates in the `zone` option, UTC by default;
a TZID that names an IANA zone; any other TZID through the file's VTIMEZONE, whose TZID is TEXT
(`Example\, Zone` is the zone `TZID="Example, Zone"` names), its STANDARD and DAYLIGHT rules
converting the times while a repeat keeps its time in the IANA zone whose clock changes match),
STATUS:CANCELLED, the RRULE subset a series holds (FREQ=DAILY, WEEKLY, MONTHLY or YEARLY with COUNT
or UNTIL, BYMONTHDAY, BYDAY with an ordinal or with BYSETPOS for monthly repeats), EXDATE,
RECURRENCE-ID overrides, the first reminder, ORGANIZER and ATTENDEE with PARTSTAT and ROLE. Of two
versions of a UID, or of one changed occurrence (a UID and its RECURRENCE-ID), the higher SEQUENCE
wins (of two equal versions of an occurrence, the later in the file). A changed occurrence whose
series is not in the file joins the series a calendar holds (`stored`, an event with that UID that
repeats), else it is imported as an event of its own (id `<uid>-<RECURRENCE-ID in UTC>`, no UID),
never in place of the series. An event takes the id of one the calendar holds (`taken`, `stored`)
only when it is that event again, the same UID (a stored event without a `uid` has the one
`eventsToIcs` writes for it). Any other event, with or without a UID, takes the next free id
(`<id>-2`, ...), keeping its UID, so an import never replaces another event. With `uidDomain`, a UID
`<id>@<uidDomain>` (what `eventsToIcs` writes) gives back the event id, so a file this package wrote
reads back as the same events. Everything else is listed once in `unsupported` as a short sentence:
a property, another component (VTODO, VJOURNAL), a repeat rule the series cannot hold (the event is
imported as its first occurrence), a zone that cannot be resolved (its times are read as UTC), what
a changed occurrence alters that an exception cannot hold. Nothing is dropped silently.

## Honest limits

- Repeat rules beyond the subset above (an INTERVAL above 1, several weekdays or dates, BYWEEKNO,
  BYYEARDAY, yearly weekday rules, RDATE, EXRULE, RANGE=THISANDFUTURE) import the first
  occurrence only, with a note. Monthly and yearly dates a month lacks are skipped, as RFC 5545
  does.
- A changed occurrence keeps its time, title and details; a changed location, people or reminder
  of one occurrence is reported and not kept. Attendee parameters other than CN, PARTSTAT and ROLE
  (RSVP, CUTYPE, DELEGATED-TO, SENT-BY) are not kept, nor are LANGUAGE and ALTREP parameters, and
  only the first reminder relative to the start is kept.
- All-day dates and floating times are floating in iCalendar: they come back in the importing
  zone, whatever zone they were written from.
- A local time in the hour a clock change repeats names two instants and the file cannot say
  which. `zonedToUtc` (moved unchanged from the `teams` area) takes the first in zones behind UTC
  and the second in zones ahead of it; the same applies when reading.
- A zone matched from a VTIMEZONE is checked against the rules of the event's first year; a zone
  that changed its rules later may drift. The week views (moved unchanged) start every day of a
  week an hour late when the anchor's day or the week's first day has no midnight (zones that
  change clocks at midnight, such as America/Santiago on 6 September 2026); the month grid does
  not.
- No free/busy, tasks, journal entries, attachments or categories; no iTIP scheduling logic
  (replies, counters). Writing METHOD:REQUEST is up to the caller.
