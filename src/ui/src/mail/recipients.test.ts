// @vitest-environment jsdom
import { emptyContact, type Contact, type MailAddress } from 'ooxml-core/mail';
import { defineMailRecipients, type MailRecipients } from './recipients';

beforeAll(() => defineMailRecipients());
afterEach(() => document.body.replaceChildren());

async function mount(
	addresses: MailAddress[] = [],
	contacts: Contact[] = [],
): Promise<MailRecipients> {
	const el = document.createElement('mail-recipients') as MailRecipients;
	el.addresses = addresses;
	el.contacts = contacts;
	document.body.append(el);
	await el.updateComplete;
	return el;
}

/** Type `text` into the field; the address lists it adds from then on. */
async function typeText(el: MailRecipients, text: string): Promise<MailAddress[][]> {
	const input = el.shadowRoot!.querySelector('input')!;
	input.value = text;
	input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
	await el.updateComplete;
	const changes: MailAddress[][] = [];
	el.addEventListener('mail-recipients-change', (e) =>
		changes.push((e as CustomEvent<{ addresses: MailAddress[] }>).detail.addresses),
	);
	return changes;
}

/** Press `key` in the field; whether the field took it (cancelled its default). */
function press(el: MailRecipients, key: string, init: KeyboardEventInit = {}): boolean {
	const event = new KeyboardEvent('keydown', {
		key,
		bubbles: true,
		composed: true,
		cancelable: true,
		...init,
	});
	el.shadowRoot!.querySelector('input')!.dispatchEvent(event);
	return event.defaultPrevented;
}

const ada: Contact = {
	...emptyContact('c1', 0),
	name: 'Ada Lovelace',
	emails: [{ type: '', address: 'ada@example.com' }],
};

/** Paste `text` into the field with `value` in it and `start`..`end` selected; what it adds. */
async function paste(
	el: MailRecipients,
	value: string,
	start: number,
	end: number,
	text: string,
): Promise<MailAddress[][]> {
	const input = el.shadowRoot!.querySelector('input')!;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
	await el.updateComplete;
	input.setSelectionRange(start, end);
	const changes: MailAddress[][] = [];
	el.addEventListener('mail-recipients-change', (e) =>
		changes.push((e as CustomEvent<{ addresses: MailAddress[] }>).detail.addresses),
	);
	const event = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clipboardData', {
		value: { getData: (kind: string) => (kind === 'text/plain' ? text : '') },
	});
	input.dispatchEvent(event);
	return changes;
}

const address = (email: string): MailAddress => ({ name: '', email });

describe('<mail-recipients>', () => {
	it('pastes a list over the selected text instead of after it', async () => {
		const el = await mount();
		expect(await paste(el, 'ann', 0, 3, 'bob@example.com, carol@example.com')).toEqual([
			[address('bob@example.com'), address('carol@example.com')],
		]);
	});

	it('pastes a list where the caret is', async () => {
		const el = await mount();
		expect(await paste(el, 'ada@example.com ', 0, 0, 'bob@example.com, ')).toEqual([
			[address('bob@example.com'), address('ada@example.com')],
		]);
		const other = await mount();
		expect(await paste(other, 'ada@example.com', 15, 15, ', bob@example.com')).toEqual([
			[address('ada@example.com'), address('bob@example.com')],
		]);
	});

	it('leaves the send chord and Shift+Tab to the app while suggestions show', async () => {
		const el = await mount([], [ada]);
		const changes = await typeText(el, 'ada');
		expect(el.shadowRoot!.querySelectorAll('[role="option"]')).toHaveLength(1);
		expect(press(el, 'Enter', { ctrlKey: true })).toBe(false);
		expect(press(el, 'Enter', { metaKey: true })).toBe(false);
		expect(press(el, 'Tab', { shiftKey: true })).toBe(false);
		// Nor are the keys an input method is composing with.
		expect(press(el, 'Enter', { isComposing: true })).toBe(false);
		expect(press(el, 'ArrowDown', { isComposing: true })).toBe(false);
		expect(changes).toEqual([]);
		// Tab on its own still takes the suggestion.
		expect(press(el, 'Tab')).toBe(true);
		expect(changes).toEqual([[{ name: 'Ada Lovelace', email: 'ada@example.com' }]]);
	});

	it('leaves the send chord to the app while an address is typed', async () => {
		const el = await mount();
		const changes = await typeText(el, 'bob@example.com');
		expect(press(el, 'Enter', { ctrlKey: true })).toBe(false);
		expect(press(el, 'Enter', { altKey: true })).toBe(false);
		expect(changes).toEqual([]);
		expect(press(el, 'Enter')).toBe(true);
		expect(changes).toEqual([[address('bob@example.com')]]);
	});
});
