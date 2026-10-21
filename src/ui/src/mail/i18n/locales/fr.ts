import { frCalendar } from './fr/calendar';
import { frCompose } from './fr/compose';
import { frContacts } from './fr/contacts';
import { frMail } from './fr/mail';
import { frShell } from './fr/shell';

/** Français. */
export const fr = { ...frShell, ...frMail, ...frCompose, ...frCalendar, ...frContacts };
