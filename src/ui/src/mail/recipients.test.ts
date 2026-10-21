// @vitest-environment jsdom
import type { MailAddress } from 'ooxml-core/mail';
import { defineMailRecipients, type MailRecipients } from './recipients';

beforeAll(() => defineMailRecipients());
afterEach(() => document.body.replaceChildren());

async function mount(addresses: MailAddress[] = []): Promise<MailRecipients> {
	const el = document.createElement('mail-recipients') as MailRecipients;
	el.addresses = addresses;
	document.body.append(el);
	await el.updateComplete;
	return el;
}

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
});
