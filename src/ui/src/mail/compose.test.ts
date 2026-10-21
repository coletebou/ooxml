// @vitest-environment jsdom
import type { ComposeState, Draft } from 'ooxml-core/mail';
import { defineMailCompose, type MailCompose } from './compose';

type Updating = HTMLElement & { updateComplete: Promise<boolean> };

beforeAll(() => defineMailCompose());
afterEach(() => {
	document.body.replaceChildren();
	Reflect.deleteProperty(document, 'execCommand');
});

const composeState = (draft: Partial<Draft> = {}): ComposeState => ({
	session: 1,
	mode: 'new',
	draft: { to: [], cc: [], bcc: [], subject: '', text: '', attachments: [], ...draft },
	status: 'editing',
	savedAt: null,
	error: null,
	uploading: 0,
});

const fields = (el: MailCompose): Updating[] => [
	...el.shadowRoot!.querySelectorAll<Updating>('mail-recipients'),
];
async function settle(el: MailCompose): Promise<void> {
	for (let i = 0; i < 3; i++) {
		await el.updateComplete;
		for (const field of fields(el)) await field.updateComplete;
	}
}
async function mount(compose: ComposeState): Promise<MailCompose> {
	const el = document.createElement('mail-compose') as MailCompose;
	el.compose = compose;
	document.body.append(el);
	await settle(el);
	return el;
}
const editor = (el: MailCompose) => el.shadowRoot!.querySelector<HTMLElement>('.editor')!;
const input = (field: Element) => field.shadowRoot!.querySelector('input')!;
function record(el: Element, ...types: string[]): [string, unknown][] {
	const seen: [string, unknown][] = [];
	for (const type of types)
		el.addEventListener(type, (e) => seen.push([type, (e as CustomEvent).detail]));
	return seen;
}
async function type(el: MailCompose, field: Element, text: string): Promise<void> {
	input(field).value = text;
	input(field).dispatchEvent(new Event('input', { bubbles: true, composed: true }));
	await settle(el);
}

/** Remote loads written the ways a sender can hide them from a plain url() filter. */
const TRACKED = [
	"background:image-set('https://t.example/a.png' 1x)",
	'background:url("https://t.example/b(1).png")',
	`background:url(https://t.example/${'c'.repeat(5000)}.png)`,
	'background:\\75 rl(https://t.example/d.png)',
	'background:url(https://t.example/e.png',
]
	.map((style, i) => `<p style="${style}">line ${i}</p>`)
	.join('');

describe('<mail-compose>', () => {
	it('quotes a message without what its CSS would load', async () => {
		const el = await mount(
			composeState({ to: [{ name: '', email: 'ada@example.com' }], html: TRACKED }),
		);
		expect(editor(el).innerHTML).not.toContain('t.example');
		expect(editor(el).textContent).toContain('line 4');
	});

	it('pastes HTML without what its CSS would load', async () => {
		const el = await mount(composeState());
		const inserted: string[] = [];
		// jsdom has neither editing commands nor innerText.
		Object.assign(document, {
			execCommand: (command: string, _ui: boolean, value: string) => {
				if (command === 'insertHTML') inserted.push(value);
				return true;
			},
		});
		Object.defineProperty(editor(el), 'innerText', { get: () => editor(el).textContent });
		const paste = new Event('paste', { bubbles: true, cancelable: true });
		Object.defineProperty(paste, 'clipboardData', {
			value: { getData: (kind: string) => (kind === 'text/html' ? TRACKED : '') },
		});
		editor(el).dispatchEvent(paste);
		expect(paste.defaultPrevented).toBe(true);
		expect(inserted).toHaveLength(1);
		expect(inserted[0]).not.toContain('t.example');
		expect(inserted[0]).toContain('line 4');
	});

	it('puts the focus in the To field of a new message', async () => {
		const el = await mount(composeState());
		const to = fields(el)[0]!;
		expect(el.shadowRoot!.activeElement).toBe(to);
		expect(to.shadowRoot!.activeElement).toBe(input(to));
	});

	it('keeps an address still being typed when the window closes or sends', async () => {
		const el = await mount(composeState());
		const seen = record(el, 'mail-draft-change', 'mail-draft-close', 'mail-draft-send');
		const ada = [{ name: '', email: 'ada@example.com' }];
		await type(el, fields(el)[0]!, 'ada@example.com');
		el.shadowRoot!.querySelector<HTMLButtonElement>('header button')!.click();
		expect(seen.splice(0)).toEqual([
			['mail-draft-change', { patch: { to: ada } }],
			['mail-draft-close', {}],
		]);
		await type(el, fields(el)[0]!, 'ada@example.com');
		el.shadowRoot!.querySelector<HTMLButtonElement>('.send')!.click();
		expect(seen).toEqual([
			['mail-draft-change', { patch: { to: ada } }],
			['mail-draft-send', {}],
		]);
	});
});
