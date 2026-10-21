// @vitest-environment jsdom
import { deepActiveElement, FocusReturn, tabStops, trapKeys } from './modal';

afterEach(() => document.body.replaceChildren());

const key = (name: string, init: KeyboardEventInit = {}) =>
	new KeyboardEvent('keydown', {
		key: name,
		bubbles: true,
		composed: true,
		cancelable: true,
		...init,
	});

/** A dialog showing a viewer that keeps its controls in a shadow root, with a slotted link. */
function mountDialog() {
	const dialog = document.createElement('section');
	dialog.innerHTML =
		'<button id="first">a</button><button disabled>b</button><span hidden><button>c</button></span><input type="hidden"><div id="viewer"><a href="#x" id="slotted">d</a></div>';
	const viewer = dialog.querySelector('#viewer')!;
	viewer.attachShadow({ mode: 'open' }).innerHTML =
		'<input id="inner"><slot></slot><div tabindex="-1" id="still">e</div><button id="last">f</button>';
	const page = document.createElement('div');
	page.append(dialog);
	document.body.append(page);
	const inViewer = (id: string) => viewer.shadowRoot!.getElementById(id)!;
	return {
		page,
		dialog,
		first: dialog.querySelector<HTMLElement>('#first')!,
		inner: inViewer('inner'),
		still: inViewer('still'),
		last: inViewer('last'),
	};
}

describe('modal dialogs', () => {
	it('list the controls Tab visits, inside shadow roots and slots too', () => {
		const { dialog } = mountDialog();
		expect(tabStops(dialog).map((el) => el.id)).toEqual(['first', 'inner', 'slotted', 'last']);
	});

	it('wrap Tab round their controls and close with Escape', () => {
		const { page, dialog, first, inner, still, last } = mountDialog();
		const closed: string[] = [];
		const reached: string[] = [];
		page.addEventListener('keydown', (e) => reached.push(e.key));
		dialog.addEventListener('keydown', (e) => trapKeys(e, () => closed.push('closed')));
		last.focus();
		const forward = key('Tab');
		last.dispatchEvent(forward);
		expect([forward.defaultPrevented, deepActiveElement(document)]).toEqual([true, first]);
		const back = key('Tab', { shiftKey: true });
		first.dispatchEvent(back);
		expect([back.defaultPrevented, deepActiveElement(document)]).toEqual([true, last]);
		// Between two controls Tab works as usual; from one Tab does not stop at, it wraps.
		inner.focus();
		const between = key('Tab');
		inner.dispatchEvent(between);
		expect(between.defaultPrevented).toBe(false);
		still.focus();
		still.dispatchEvent(key('Tab'));
		expect(deepActiveElement(document)).toBe(first);
		// Escape a control handled itself (closing its own popup) leaves the dialog open.
		const handled = key('Escape');
		handled.preventDefault();
		first.dispatchEvent(handled);
		first.dispatchEvent(key('Escape'));
		expect(closed).toEqual(['closed']);
		expect(reached).toEqual([]);
	});

	it('give the focus back to what had it, while it is on the page', () => {
		const opener = document.createElement('button');
		const gone = document.createElement('button');
		document.body.append(opener, gone);
		const focus = new FocusReturn();
		opener.focus();
		focus.take(document);
		gone.focus();
		focus.restore();
		expect(document.activeElement).toBe(opener);
		focus.take(document);
		gone.focus();
		opener.remove();
		focus.restore();
		expect(document.activeElement).toBe(gone);
	});
});
