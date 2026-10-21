import { esCalendar } from './es/calendar';
import { esCompose } from './es/compose';
import { esContacts } from './es/contacts';
import { esMail } from './es/mail';
import { esShell } from './es/shell';

/** Español. */
export const es = { ...esShell, ...esMail, ...esCompose, ...esCalendar, ...esContacts };
