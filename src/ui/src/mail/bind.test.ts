// @vitest-environment jsdom
import { applyMailProps, type MailProps } from './bind';
import { defineMailApp, type MailApp } from './mail-app';

beforeAll(() => defineMailApp());

/** A `<mail-app>` that is never connected, so no client starts. */
const app = (): MailApp => document.createElement('mail-app') as MailApp;
const shown = (el: MailApp) => [el.locale, el.theme, el.view, el.config];

describe('applyMailProps', () => {
	it('puts each prop a host takes away back to its default, the view included', () => {
		const el = app();
		const given: MailProps = {
			locale: 'de',
			theme: 'dark',
			view: 'calendar',
			config: { kind: 'demo', seed: { bulk: 1 } },
		};
		applyMailProps(el, given);
		expect(shown(el)).toEqual(['de', 'dark', 'calendar', given.config]);
		applyMailProps(el, {}, given);
		expect(shown(el)).toEqual(['', 'system', 'mail', null]);
	});

	it('leaves the view a person picked while the host passes the same view or none', () => {
		const el = app();
		applyMailProps(el, { view: 'calendar' });
		// Contacts, picked on the rail: the host's next renders pass what they passed before.
		el.view = 'contacts';
		applyMailProps(el, { view: 'calendar', locale: 'de' }, { view: 'calendar' });
		expect(el.view).toBe('contacts');
		const other = app();
		other.view = 'calendar';
		applyMailProps(other, { locale: 'de' });
		applyMailProps(other, { locale: 'fr' }, { locale: 'de' });
		expect(other.view).toBe('calendar');
	});
});
