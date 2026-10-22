import { zhCNCalendar } from './zh-CN/calendar';
import { zhCNCompose } from './zh-CN/compose';
import { zhCNContacts } from './zh-CN/contacts';
import { zhCNMail } from './zh-CN/mail';
import { zhCNShell } from './zh-CN/shell';

/** 简体中文. */
export const zhCN = { ...zhCNShell, ...zhCNMail, ...zhCNCompose, ...zhCNCalendar, ...zhCNContacts };
