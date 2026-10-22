import { deCalendar } from './de/calendar';
import { deCompose } from './de/compose';
import { deContacts } from './de/contacts';
import { deMail } from './de/mail';
import { deShell } from './de/shell';

/** Deutsch. */
export const de = { ...deShell, ...deMail, ...deCompose, ...deCalendar, ...deContacts };
