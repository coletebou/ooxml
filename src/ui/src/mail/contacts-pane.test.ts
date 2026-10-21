// @vitest-environment jsdom
import { emptyContact, type Contact, type ContactAddress } from 'ooxml-core/mail';
import { defineMailContacts, type MailContacts } from './contacts-pane';

beforeAll(() => defineMailContacts());
afterEach(() => document.body.replaceChildren());

const contact = (id: string, name: string, over: Partial<Contact> = {}): Contact => ({
	...emptyContact(id, 0),
	name,
	emails: [{ type: '', address: `${id}@example.com` }],
	...over,
});
const place = (over: Partial<ContactAddress>): ContactAddress => ({
	type: '',
	poBox: '',
	extended: '',
	street: '',
	locality: '',
	region: '',
	postalCode: '',
	country: '',
	...over,
});

async function mount(contacts: Contact[]): Promise<MailContacts> {
	const el = document.createElement('mail-contacts') as MailContacts;
	el.contacts = contacts;
	document.body.append(el);
	await el.updateComplete;
	return el;
}
async function click(el: MailContacts, name: string): Promise<void> {
	const buttons = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('button')];
	const button = buttons.find((b) => b.textContent!.trim() === name);
	if (!button) throw new Error(`no button ${name}`);
	button.click();
	await el.updateComplete;
}
function saved(el: MailContacts): Contact[] {
	const seen: Contact[] = [];
	el.addEventListener('mail-save-contact', (e) =>
		seen.push((e as CustomEvent<{ contact: Contact }>).detail.contact),
	);
	return seen;
}
const field = (el: MailContacts, name: string) =>
	el.shadowRoot!.querySelector<HTMLInputElement>(`[name="${name}"]`)!;

describe('<mail-contacts>', () => {
	it('keeps the parts of an address the form does not show', async () => {
		const box = place({ type: 'work', poBox: 'PO Box 7', extended: 'Suite 2' });
		const el = await mount([contact('ada', 'Ada', { addresses: [box] })]);
		const seen = saved(el);
		await click(el, 'Edit');
		await click(el, 'Save');
		expect(seen.map((c) => c.addresses)).toEqual([[box]]);
	});

	it('drops an address whose shown parts were all cleared', async () => {
		const home = place({ extended: 'Apt 4', street: 'Main St 1', locality: 'Springfield' });
		const el = await mount([contact('ada', 'Ada', { addresses: [home] })]);
		const seen = saved(el);
		await click(el, 'Edit');
		field(el, 'street').value = '';
		field(el, 'locality').value = '';
		await click(el, 'Save');
		expect(seen.map((c) => c.addresses)).toEqual([[]]);
	});

	it('moves through the list and selects with the keyboard', async () => {
		const el = await mount([contact('ada', 'Ada'), contact('bob', 'Bob'), contact('cy', 'Cy')]);
		const list = el.shadowRoot!.querySelector<HTMLElement>('[role="listbox"]')!;
		expect(list.tabIndex).toBe(0);
		list.focus();
		const press = async (name: string): Promise<KeyboardEvent> => {
			const event = new KeyboardEvent('keydown', {
				key: name,
				bubbles: true,
				composed: true,
				cancelable: true,
			});
			list.dispatchEvent(event);
			await el.updateComplete;
			return event;
		};
		const active = () =>
			list.querySelector(`[id="${list.getAttribute('aria-activedescendant')}"] strong`)
				?.textContent;
		const shown = () => el.shadowRoot!.querySelector('.detail h2')!.textContent;
		expect([active(), shown()]).toEqual(['Ada', 'Ada']);
		expect((await press('ArrowDown')).defaultPrevented).toBe(true);
		// Moving is not choosing: Enter (or Space) shows the contact.
		expect([active(), shown()]).toEqual(['Bob', 'Ada']);
		await press('Enter');
		expect(shown()).toBe('Bob');
		expect(list.querySelector('[aria-selected="true"] strong')!.textContent).toBe('Bob');
		await press('End');
		expect(active()).toBe('Cy');
		await press('ArrowDown');
		expect(active()).toBe('Cy');
		await press('Home');
		await press(' ');
		expect([active(), shown()]).toEqual(['Ada', 'Ada']);
		expect((await press('a')).defaultPrevented).toBe(false);
	});
});
