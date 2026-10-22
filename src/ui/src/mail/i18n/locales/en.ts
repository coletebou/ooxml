import { enCalendar } from './en/calendar';
import { enCompose } from './en/compose';
import { enContacts } from './en/contacts';
import { enMail } from './en/mail';
import { enShell } from './en/shell';

/** The English dictionary: the contract every other locale must meet key for key. */
export const en = { ...enShell, ...enMail, ...enCompose, ...enCalendar, ...enContacts };
