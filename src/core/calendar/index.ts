// `ooxml-core/calendar`: the format-neutral calendar every product shares. Zone arithmetic on
// instants with the platform's IANA data, repeating series (daily, weekly, monthly on a date or a
// weekday ordinal, yearly) with cancelled and changed occurrences, occurrence expansion, the day,
// work-week, week and month views and the layout of a day, and iCalendar (RFC 5545) export and
// import. No DOM, no storage, no clock. See docs/calendar-area.md.
export * from './model';
export * from './time-zone';
export * from './recurrence-calendar';
export * from './recurrence';
export * from './occurrences';
export * from './views';
export * from './layout';
export * from './ics-timezone';
export * from './ics-write';
export * from './ics-read';
export type { Component, ComponentTree, ContentLine } from './ics-lines';
export { parseContentLine, readComponents, unescapeText, unfoldLines } from './ics-lines';
