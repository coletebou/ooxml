// @vitest-environment happy-dom
import type { PptxAction, PptxElement } from 'pptx-viewer-core';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HyperlinkEditDialog } from './HyperlinkEditDialog';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement('div');
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

const element = (actionClick?: PptxAction): PptxElement =>
	({ id: 'e1', type: 'shape', x: 0, y: 0, width: 10, height: 10, actionClick }) as PptxElement;

const handlers = () => ({ onConfirm: vi.fn(), onRemove: vi.fn(), onCancel: vi.fn() });

function render(open: boolean, el: PptxElement | undefined, on = handlers()) {
	act(() => root.render(<HyperlinkEditDialog open={open} element={el} slideCount={4} {...on} />));
	return on;
}

// No translation provider: each control shows, and is named by, its dictionary key.
const field = (name: string) =>
	container.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`);
const pressedTab = () =>
	Array.from(container.querySelectorAll('button[aria-pressed="true"]')).map((b) => b.textContent);
const footerIds = () =>
	Array.from(
		container.querySelector('pptx-ui-dialog-footer')!.shadowRoot!.querySelectorAll('button'),
	).map((b) => b.textContent);

function type(input: HTMLInputElement, value: string): void {
	const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
	act(() => {
		setter.call(input, value);
		input.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

describe('hyperlinkEditDialog', () => {
	it('fills its fields from the element it opens on, each time it opens', () => {
		render(false, undefined);
		render(true, element({ url: 'https://a.example', tooltip: 'Open' }));
		expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
			'pptx.hyperlink.editTitle',
		);
		expect(pressedTab()).toStrictEqual(['pptx.hyperlink.tabUrl']);
		expect(field('pptx.hyperlink.urlLabel')?.value).toBe('https://a.example');
		expect(field('pptx.hyperlink.tooltipLabel')?.value).toBe('Open');

		render(false, undefined);
		render(true, element({ url: 'mailto:b@c.d?subject=Hi' }));
		expect(pressedTab()).toStrictEqual(['pptx.hyperlink.tabEmail']);
		expect(field('pptx.hyperlink.emailLabel')?.value).toBe('b@c.d');
		expect(field('pptx.hyperlink.subjectLabel')?.value).toBe('Hi');
		expect(field('pptx.hyperlink.tooltipLabel')?.value).toBe('');

		render(false, undefined);
		render(
			true,
			element({ action: 'ppaction://hlinksldjump', url: 'slide5.xml', targetSlideIndex: 1 }),
		);
		// The slide's place in the deck, not the number in its part name.
		expect(pressedTab()).toStrictEqual(['pptx.hyperlink.tabSlide']);
		expect(field('pptx.hyperlink.slideLabel')?.value).toBe('2');
	});

	it('offers Remove link only while the element links somewhere', () => {
		render(true, element());
		expect(footerIds()).toStrictEqual(['pptx.common.cancel', 'pptx.common.apply']);
		render(false, undefined);
		const on = render(true, element({ action: 'ppaction://hlinksldjump', targetSlideIndex: 0 }));
		expect(footerIds()).toStrictEqual([
			'pptx.hyperlinkDialog.removeLink',
			'pptx.common.cancel',
			'pptx.common.apply',
		]);
		act(() =>
			container
				.querySelector('pptx-ui-dialog-footer')!
				.shadowRoot!.querySelector('button')!
				.click(),
		);
		expect(on.onRemove).toHaveBeenCalledOnce();
	});

	it('hands the edited fields to onConfirm', () => {
		const on = render(true, element());
		act(() =>
			Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'))
				.find((b) => b.textContent === 'pptx.hyperlink.tabSlide')!
				.click(),
		);
		expect(pressedTab()).toStrictEqual(['pptx.hyperlink.tabSlide']);
		type(field('pptx.hyperlink.slideLabel')!, '3');
		type(field('pptx.hyperlink.tooltipLabel')!, 'Go');
		act(() => {
			field('pptx.hyperlink.slideLabel')!.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
			);
		});
		expect(on.onConfirm).toHaveBeenCalledWith(
			expect.objectContaining({ targetType: 'slide', slideNumber: 3, tooltip: 'Go' }),
		);
	});
});
