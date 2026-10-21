// @vitest-environment jsdom
import { defineMailMessageList, type MailMessageList } from './message-list';

/** A ResizeObserver that keeps what it observes and reports a resize when asked (jsdom has none). */
class FakeObserver {
	static made: FakeObserver[] = [];
	readonly targets = new Set<Element>();
	constructor(private readonly callback: ResizeObserverCallback) {
		FakeObserver.made.push(this);
	}
	observe(target: Element): void {
		this.targets.add(target);
	}
	unobserve(target: Element): void {
		this.targets.delete(target);
	}
	disconnect(): void {
		this.targets.clear();
	}
	/** A resize of what it observes, as a browser reports one. */
	resized(): void {
		if (this.targets.size) this.callback([], this as unknown as ResizeObserver);
	}
}

beforeAll(() => defineMailMessageList());
beforeEach(() => {
	FakeObserver.made = [];
	vi.stubGlobal('ResizeObserver', FakeObserver);
});
afterEach(() => {
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});

describe('<mail-message-list>', () => {
	it('follows the height of its viewport after it is moved in the page', async () => {
		const list = document.createElement('mail-message-list') as MailMessageList;
		document.body.append(list);
		await list.updateComplete;
		const viewport = list.shadowRoot!.querySelector<HTMLElement>('.viewport')!;
		const watching = () => FakeObserver.made.filter((observer) => observer.targets.has(viewport));
		expect(watching()).toHaveLength(1);
		// Moved as an app moves with its panes: the same element, disconnected and connected again.
		const pane = document.createElement('div');
		document.body.append(pane);
		pane.append(list);
		await list.updateComplete;
		expect(watching()).toHaveLength(1);
		// The taller pane it is in now shows rows down to its foot.
		Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 900 });
		for (const observer of watching()) observer.resized();
		expect(list.height).toBe(900);
		// Taken out of the page, it observes nothing.
		list.remove();
		expect(watching()).toHaveLength(0);
	});
});
