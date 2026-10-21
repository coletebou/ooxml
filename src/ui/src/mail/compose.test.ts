// @vitest-environment jsdom
import type { ComposeState, Draft } from 'ooxml-core/mail';
import { defineMailCompose, type MailCompose } from './compose';

type Updating = HTMLElement & { updateComplete: Promise<boolean> };

beforeAll(() => defineMailCompose());
afterEach(() => {
	document.body.replaceChildren();
	for (const name of ['execCommand', 'getSelection', 'caretPositionFromPoint'])
		Reflect.deleteProperty(document, name);
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

	it('drops HTML into the editor through the sanitiser, where the browser would put it', async () => {
		const el = await mount(composeState());
		const inserted: [string, Range | undefined][] = [];
		// jsdom has no caret lookup by point and keeps no selection inside a shadow tree, so the test
		// answers the first and records what the editor asks of the second.
		const ranges: Range[] = [];
		let point: { offsetNode: Node; offset: number } | null = null;
		Object.assign(document, {
			execCommand: (command: string, _ui: boolean, value: string) => {
				if (command === 'insertHTML') inserted.push([value, ranges.at(-1)]);
				return true;
			},
			getSelection: () => ({
				rangeCount: 0,
				removeAllRanges: () => {},
				addRange: (range: Range) => ranges.push(range),
			}),
			caretPositionFromPoint: () => point,
		});
		Object.defineProperty(editor(el), 'innerText', { get: () => editor(el).textContent });
		editor(el).innerHTML = '<p>first</p><p>second</p>';
		const second = editor(el).lastChild!;
		const seen = record(el, 'mail-draft-change');
		const drop = (on: Node, types: Record<string, string>) => {
			const event = new Event('drop', { bubbles: true, cancelable: true, composed: true });
			Object.defineProperty(event, 'dataTransfer', {
				value: {
					files: [],
					types: Object.keys(types),
					getData: (kind: string) => types[kind] ?? '',
				},
			});
			on.dispatchEvent(event);
			return event;
		};
		point = { offsetNode: second.firstChild!, offset: 3 };
		const html = drop(second, { 'text/html': TRACKED, 'text/plain': 'line 0' });
		expect(html.defaultPrevented).toBe(true);
		expect(inserted).toHaveLength(1);
		expect(inserted[0]![0]).not.toContain('t.example');
		expect(inserted[0]![0]).toContain('line 4');
		expect([inserted[0]![1]?.startContainer, inserted[0]![1]?.startOffset]).toEqual([
			second.firstChild,
			3,
		]);
		expect(seen).toHaveLength(1);
		// No point to go by: the end of the editor.
		point = null;
		expect(drop(second, { 'text/html': '<b>x</b>' }).defaultPrevented).toBe(true);
		expect([inserted[1]![1]?.startContainer, inserted[1]![1]?.startOffset]).toEqual([
			editor(el),
			2,
		]);
		// Plain text cannot load anything, and a move inside the editor is the editor's own
		// content: the browser does both itself.
		expect(drop(second, { 'text/plain': 'just words' }).defaultPrevented).toBe(false);
		editor(el).dispatchEvent(new Event('dragstart', { bubbles: true, composed: true }));
		expect(drop(second, { 'text/html': '<b>moved</b>' }).defaultPrevented).toBe(false);
		editor(el).dispatchEvent(new Event('dragend', { bubbles: true, composed: true }));
		expect(drop(second, { 'text/html': '<b>x</b>' }).defaultPrevented).toBe(true);
		expect(inserted).toHaveLength(3);
		// Dropped on the subject field, HTML becomes plain text there: the browser's to do.
		expect(
			drop(el.shadowRoot!.querySelector('.subject')!, { 'text/html': '<b>x</b>' }).defaultPrevented,
		).toBe(false);
	});

	it('shows the identity a draft is sent from, also after another was picked', async () => {
		const identities = ['one', 'two', 'three'].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			replyTo: [],
			bcc: [],
			textSignature: '',
			htmlSignature: '',
		}));
		const el = document.createElement('mail-compose') as MailCompose;
		el.identities = identities;
		el.compose = composeState({ identityId: 'two' });
		document.body.append(el);
		await settle(el);
		const from = el.shadowRoot!.querySelector('select')!;
		expect(from.value).toBe('two');
		from.value = 'one';
		from.dispatchEvent(new Event('change'));
		el.compose = { ...composeState({ identityId: 'three' }), session: 2 };
		await settle(el);
		expect(from.value).toBe('three');
	});

	it('keeps Send off while picked files are still being read', async () => {
		const el = await mount(composeState({ to: [{ name: '', email: 'ada@example.com' }] }));
		const seen = record(el, 'mail-draft-attach');
		let read: (bytes: ArrayBuffer) => void = () => {};
		const file = {
			name: 'big.bin',
			type: 'application/octet-stream',
			arrayBuffer: () => new Promise<ArrayBuffer>((resolve) => (read = resolve)),
		};
		const drop = new Event('drop', { bubbles: true, cancelable: true, composed: true });
		Object.defineProperty(drop, 'dataTransfer', { value: { files: [file], types: ['Files'] } });
		el.shadowRoot!.querySelector('section')!.dispatchEvent(drop);
		await settle(el);
		const send = el.shadowRoot!.querySelector<HTMLButtonElement>('.send')!;
		expect(send.disabled).toBe(true);
		expect(el.readingFiles).toBe(true);
		read(new Uint8Array([1, 2]).buffer);
		await vi.waitFor(() => expect(seen).toHaveLength(1));
		await settle(el);
		expect(send.disabled).toBe(false);
		expect(el.readingFiles).toBe(false);
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
