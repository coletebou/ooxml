import type { PptxAction, PptxElement } from 'pptx-viewer-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTranslator } from '../i18n';
import { allButtons } from './dialog-footer.test-support';
import { openHyperlinkEditDialog } from './hyperlink-edit-dialog';

afterEach(() => {
	document.body.replaceChildren();
});

const element = (actionClick?: PptxAction) =>
	({ id: 'e1', type: 'shape', x: 0, y: 0, width: 10, height: 10, actionClick }) as PptxElement;

const button = (label: string) => allButtons(document).find((b) => b.textContent === label);

function type(label: string, value: string): void {
	const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
	if (!input) {
		throw new Error(`no field ${label}`);
	}
	input.value = value;
	input.dispatchEvent(new Event('input'));
}

describe('openHyperlinkEditDialog', () => {
	it('keeps the existing link when a blocked address is typed', () => {
		const onApply = vi.fn();
		openHyperlinkEditDialog(
			document,
			createTranslator(),
			element({ url: 'https://a.example' }),
			onApply,
		);
		const address = document.querySelector<HTMLInputElement>('input')!;
		address.value = `${'javascript'}:alert(1)`;
		address.dispatchEvent(new Event('input'));
		button('Apply')!.click();
		expect(onApply).not.toHaveBeenCalled();
	});

	it('offers Remove link only while the element links somewhere', () => {
		openHyperlinkEditDialog(document, createTranslator(), element(), vi.fn());
		expect(button('Remove link')).toBeUndefined();
		document.body.replaceChildren();
		const onApply = vi.fn();
		openHyperlinkEditDialog(
			document,
			createTranslator(),
			element({ action: 'ppaction://hlinksldjump', targetSlideIndex: 0 }),
			onApply,
		);
		button('Remove link')!.click();
		expect(onApply).toHaveBeenCalledWith({ actionClick: undefined });
	});

	it('links to a slide through the Slide tab, inside the deck', () => {
		const onApply = vi.fn();
		openHyperlinkEditDialog(document, createTranslator(), element(), onApply, undefined, 4);
		button('Slide')!.click();
		expect(document.querySelector('button[aria-pressed="true"]')?.textContent).toBe('Slide');
		type('Slide number', '9');
		type('Screen tip', 'Go');
		button('Apply')!.click();
		expect(onApply).toHaveBeenCalledWith({
			actionClick: { action: 'ppaction://hlinksldjump', targetSlideIndex: 3, tooltip: 'Go' },
		});
	});

	it('opens on the target the element has, its fields named by their labels', () => {
		openHyperlinkEditDialog(
			document,
			createTranslator(),
			element({ url: 'mailto:a@b.c?subject=Hi', tooltip: 'Mail' }),
			vi.fn(),
		);
		expect(document.querySelector('button[aria-pressed="true"]')?.textContent).toBe('Email');
		const value = (label: string) =>
			document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)?.value;
		expect([value('Email address'), value('Subject'), value('Screen tip')]).toStrictEqual([
			'a@b.c',
			'Hi',
			'Mail',
		]);
	});
});
