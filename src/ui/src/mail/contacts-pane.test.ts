// @vitest-environment jsdom
import { emptyContact, parseVCards, type Contact, type ContactAddress } from 'ooxml-core/mail';
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

	it('keeps the values a card gave an address part and a name through a save', async () => {
		const box = place({ street: 'Line 1,Line 2', lists: { street: ['Line 1', 'Line 2'] } });
		const lists = { familyName: ['Doe', 'Smith'] };
		const el = await mount([
			contact('ada', 'Ada', { familyName: 'Doe,Smith', addresses: [box], lists }),
		]);
		const seen = saved(el);
		await click(el, 'Edit');
		await click(el, 'Save');
		expect(seen.map((c) => [c.addresses, c.lists])).toEqual([[[box], lists]]);
	});

	it('keeps every phone and address label, including ones it has no option of its own for', async () => {
		const phones = [
			{ type: 'pager', number: '+1 555 0100' },
			{ type: 'main', number: '+1 555 0101' },
			{ type: 'cell', number: '+1 555 0102' },
		];
		const emails = [{ type: 'school', address: 'ada@example.com' }];
		const el = await mount([contact('ada', 'Ada', { phones, emails })]);
		const seen = saved(el);
		await click(el, 'Edit');
		const shown = (name: string) =>
			el.shadowRoot!.querySelector<HTMLSelectElement>(`[name="${name}"]`)!.selectedOptions[0]!
				.textContent;
		expect([shown('phone-type-0'), shown('phone-type-1'), shown('email-type-0')]).toEqual([
			'Pager',
			'main',
			'school',
		]);
		await click(el, 'Save');
		expect(seen.map((c) => [c.phones, c.emails])).toEqual([[phones, emails]]);
	});

	it('keeps the PO box of an address whose street and city were cleared', async () => {
		const both = place({ poBox: 'PO Box 7', street: 'Main St 1', locality: 'Springfield' });
		const el = await mount([contact('ada', 'Ada', { addresses: [both] })]);
		const seen = saved(el);
		expect(el.shadowRoot!.querySelector('.detail dl')!.textContent).toContain(
			'Main St 1, PO Box 7, Springfield',
		);
		await click(el, 'Edit');
		field(el, 'street').value = '';
		field(el, 'locality').value = '';
		await click(el, 'Save');
		expect(seen.map((c) => c.addresses)).toEqual([[place({ poBox: 'PO Box 7' })]]);
	});

	it('shows the PO box and the apartment line an address has, and only then', async () => {
		const full = place({ poBox: 'PO Box 7', extended: 'Suite 2', street: 'Main St 1' });
		const el = await mount([
			contact('ada', 'Ada', { addresses: [full] }),
			contact('bob', 'Bob', { addresses: [place({ street: 'Elm St 2' })] }),
		]);
		const seen = saved(el);
		await click(el, 'Edit');
		const labels = () =>
			[...el.shadowRoot!.querySelectorAll('fieldset')]
				.find((set) => set.querySelector('legend')!.textContent === 'Address')!
				.querySelectorAll('label > span');
		expect([...labels()].map((label) => label.textContent)).toEqual([
			'Street',
			'Apartment or suite',
			'PO box',
			'City',
			'State or region',
			'Postal code',
			'Country',
		]);
		// Every part shown, so clearing them all takes the address away, knowingly.
		for (const name of ['poBox', 'extended', 'street']) field(el, name).value = '';
		await click(el, 'Save');
		expect(seen.map((c) => c.addresses)).toEqual([[]]);
		// A contact without them (vCard 4 advises leaving both empty) is not asked for them.
		el.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')[1]!.click();
		await el.updateComplete;
		await click(el, 'Edit');
		expect([field(el, 'poBox'), field(el, 'extended')]).toEqual([null, null]);
		expect(labels()).toHaveLength(5);
	});

	it('drops an address whose shown parts were all cleared', async () => {
		const home = place({ extended: 'Apt 4', street: 'Main St 1', locality: 'Springfield' });
		const el = await mount([contact('ada', 'Ada', { addresses: [home] })]);
		const seen = saved(el);
		await click(el, 'Edit');
		// The apartment line shows too, as the address has one.
		for (const name of ['street', 'extended', 'locality']) field(el, name).value = '';
		await click(el, 'Save');
		expect(seen.map((c) => c.addresses)).toEqual([[]]);
	});

	it('starts a new contact on an empty form, whatever the last form held unsaved', async () => {
		const el = await mount([contact('ada', 'Ada')]);
		const seen = saved(el);
		await click(el, 'Edit');
		// Typed into fields Ada has nothing in, then left without saving.
		field(el, 'phone-0').value = '+1 555 0100';
		field(el, 'street').value = 'Main St 1';
		field(el, 'note').value = 'Call after six';
		await click(el, 'New contact');
		const values = () => ['phone-0', 'street', 'note'].map((name) => field(el, name).value);
		expect(values()).toEqual(['', '', '']);
		field(el, 'name').value = 'Bob';
		await click(el, 'Save');
		expect(seen.map((c) => [c.name, c.phones, c.addresses, c.note])).toEqual([['Bob', [], [], '']]);
	});

	it('opens the vCard file picker from an Import button the keyboard reaches', async () => {
		const el = await mount([contact('ada', 'Ada')]);
		const importer = el.shadowRoot!.querySelector<HTMLButtonElement>(
			'.toolbar button[aria-label="Import vCard files"]',
		);
		expect(importer?.tabIndex).toBe(0);
		const picker = el.shadowRoot!.querySelector<HTMLInputElement>('input[type="file"]')!;
		const opened = vi.fn();
		picker.addEventListener('click', opened);
		importer!.click();
		expect(opened).toHaveBeenCalledOnce();
		expect([picker.hidden, picker.accept]).toEqual([true, '.vcf,text/vcard,text/x-vcard']);
	});

	it('imports every vCard file picked, in one go', async () => {
		const el = await mount([contact('ada', 'Ada')]);
		const picker = el.shadowRoot!.querySelector<HTMLInputElement>('input[type="file"]')!;
		const card = (name: string) => `BEGIN:VCARD\r\nVERSION:4.0\r\nFN:${name}\r\nEND:VCARD`;
		// The first file ends without a line break after its card; the second holds two cards.
		const files = [
			new File([card('Bea')], 'bea.vcf', { type: 'text/vcard' }),
			new File([`${card('Cy')}\r\n${card('Dee')}\r\n`], 'team.vcf', { type: 'text/vcard' }),
		];
		Object.defineProperty(picker, 'files', { value: files, configurable: true });
		const imported: string[] = [];
		el.addEventListener('mail-import-vcf', (e) =>
			imported.push((e as CustomEvent<{ text: string }>).detail.text),
		);
		picker.dispatchEvent(new Event('change'));
		await vi.waitFor(() => expect(imported).toHaveLength(1));
		expect(parseVCards(imported[0]!).contacts.map((c) => c.name)).toEqual(['Bea', 'Cy', 'Dee']);
		expect(picker.multiple).toBe(true);
	});

	it('imports the vCard files it can read and names those it cannot', async () => {
		const el = await mount([contact('ada', 'Ada')]);
		const picker = el.shadowRoot!.querySelector<HTMLInputElement>('input[type="file"]')!;
		const refuse = () =>
			Promise.reject(new DOMException('The requested file could not be read.', 'NotReadableError'));
		const files = [
			new File(['BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Bea\r\nEND:VCARD\r\n'], 'bea.vcf'),
			{ name: 'gone.vcf', type: 'text/vcard', text: refuse, arrayBuffer: refuse },
		];
		Object.defineProperty(picker, 'files', { value: files, configurable: true });
		const seen: [string, unknown][] = [];
		for (const type of ['mail-import-vcf', 'mail-files-unreadable'])
			el.addEventListener(type, (e) => seen.push([type, (e as CustomEvent).detail]));
		picker.dispatchEvent(new Event('change'));
		await vi.waitFor(() => expect(seen).toHaveLength(2));
		expect(seen).toEqual([
			['mail-import-vcf', { text: 'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Bea\r\nEND:VCARD\r\n' }],
			['mail-files-unreadable', { names: ['gone.vcf'] }],
		]);
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
