import { mount } from '@vue/test-utils';
import type { PptxAction, PptxElement } from 'pptx-viewer-core';
import { afterEach, describe, expect, it } from 'vitest';

import { allButtons } from './dialog-footer.test-support';
import HyperlinkDialog from './HyperlinkDialog.vue';

afterEach(() => {
	document.body.innerHTML = '';
});

function element(actionClick?: PptxAction): PptxElement {
	return {
		type: 'shape',
		id: 's1',
		x: 0,
		y: 0,
		width: 100,
		height: 40,
		actionClick,
	} as PptxElement;
}

function urlInput(): HTMLInputElement {
	const input = document.body.querySelector<HTMLInputElement>('input[type="url"]');
	if (!input) {
		throw new Error('url input not found');
	}
	return input;
}

function clickButton(label: string): void {
	const btn = allButtons(document.body).find((b) => b.textContent?.trim() === label);
	if (!btn) {
		throw new Error(`button "${label}" not found`);
	}
	btn.click();
}

describe('hyperlinkDialog', () => {
	it('prefills the current URL and tooltip when opened', () => {
		mount(HyperlinkDialog, {
			props: {
				open: true,
				element: element({ url: 'https://existing.test', tooltip: 'Go there' }),
			},
			attachTo: document.body,
		});
		expect(urlInput().value).toBe('https://existing.test');
		const tooltipInput = document.body.querySelector<HTMLInputElement>('input[type="text"]');
		expect(tooltipInput?.value).toBe('Go there');
	});

	it('emits a save patch that sets actionClick.url on Apply', async () => {
		const wrapper = mount(HyperlinkDialog, {
			props: { open: true, element: element() },
			attachTo: document.body,
		});

		const input = urlInput();
		input.value = 'https://new.test';
		input.dispatchEvent(new Event('input'));
		await wrapper.vm.$nextTick();

		clickButton('Apply');
		await wrapper.vm.$nextTick();

		const saved = wrapper.emitted('save');
		expect(saved).toHaveLength(1);
		const patch = saved?.[0]?.[0] as Partial<PptxElement>;
		expect(patch.actionClick?.url).toBe('https://new.test');
		expect(wrapper.emitted('close')).toHaveLength(1);
	});

	it('emits a clearing patch (actionClick: undefined) on Remove link', async () => {
		const wrapper = mount(HyperlinkDialog, {
			props: {
				open: true,
				element: element({ url: 'https://existing.test' }),
			},
			attachTo: document.body,
		});

		clickButton('Remove link');
		await wrapper.vm.$nextTick();

		const saved = wrapper.emitted('save');
		expect(saved).toHaveLength(1);
		const patch = saved?.[0]?.[0] as Partial<PptxElement>;
		expect('actionClick' in patch).toBeTruthy();
		expect(patch.actionClick).toBeUndefined();
		expect(wrapper.emitted('close')).toHaveLength(1);
	});

	it('treats an emptied URL as a clear on Apply', async () => {
		const wrapper = mount(HyperlinkDialog, {
			props: {
				open: true,
				element: element({ url: 'https://existing.test' }),
			},
			attachTo: document.body,
		});

		const input = urlInput();
		input.value = '';
		input.dispatchEvent(new Event('input'));
		await wrapper.vm.$nextTick();

		clickButton('Apply');
		await wrapper.vm.$nextTick();

		const patch = wrapper.emitted('save')?.[0]?.[0] as Partial<PptxElement>;
		expect(patch.actionClick).toBeUndefined();
	});

	it('emits the OOXML jump verb when a show jump is chosen', async () => {
		const wrapper = mount(HyperlinkDialog, {
			props: { open: true, element: element() },
			attachTo: document.body,
		});

		// The Action tab's select drives the emitted action: pick "End Show".
		clickButton('Action');
		await wrapper.vm.$nextTick();
		const select = document.body.querySelector<HTMLSelectElement>(
			'pptx-ui-select[aria-label="Action"]',
		);
		if (!select) {
			throw new Error('show jump select not found');
		}
		select.value = 'endShow';
		select.dispatchEvent(new Event('change'));
		await wrapper.vm.$nextTick();

		clickButton('Apply');
		await wrapper.vm.$nextTick();

		const patch = wrapper.emitted('save')?.[0]?.[0] as Partial<PptxElement>;
		expect(patch.actionClick?.action).toBe('ppaction://hlinkshowjump?jump=endshow');
	});

	it('links to an email address with a subject', async () => {
		const wrapper = mount(HyperlinkDialog, {
			props: { open: true, element: element() },
			attachTo: document.body,
		});
		clickButton('Email');
		await wrapper.vm.$nextTick();
		for (const [label, value] of [
			['Email address', 'a@b.c'],
			['Subject', 'Q1 review'],
		]) {
			const input = document.body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
			input.value = value;
			input.dispatchEvent(new Event('input'));
		}
		await wrapper.vm.$nextTick();
		clickButton('Apply');
		await wrapper.vm.$nextTick();

		const patch = wrapper.emitted('save')?.[0]?.[0] as Partial<PptxElement>;
		expect(patch).toStrictEqual({ actionClick: { url: 'mailto:a@b.c?subject=Q1%20review' } });
	});

	it('applies nothing for an address the URL guard blocks', async () => {
		const wrapper = mount(HyperlinkDialog, {
			props: { open: true, element: element({ url: 'https://existing.test' }) },
			attachTo: document.body,
		});
		const input = urlInput();
		input.value = `${'javascript'}:alert(1)`;
		input.dispatchEvent(new Event('input'));
		await wrapper.vm.$nextTick();

		clickButton('Apply');
		await wrapper.vm.$nextTick();

		expect(wrapper.emitted('save')).toBeUndefined();
		expect(wrapper.emitted('close')).toHaveLength(1);
	});

	it("keeps a link left as it was, and the action's own settings", async () => {
		const loaded = {
			rId: 'rId4',
			url: 'https://existing.test',
			highlightClick: true,
			soundRId: 'rId9',
		};
		const wrapper = mount(HyperlinkDialog, {
			props: { open: true, element: element(loaded) },
			attachTo: document.body,
		});
		const tooltip = document.body.querySelector<HTMLInputElement>('input[type="text"]')!;
		tooltip.value = 'Go there';
		tooltip.dispatchEvent(new Event('input'));
		await wrapper.vm.$nextTick();
		clickButton('Apply');
		await wrapper.vm.$nextTick();

		const patch = wrapper.emitted('save')?.[0]?.[0] as Partial<PptxElement>;
		expect(patch).toStrictEqual({ actionClick: { ...loaded, tooltip: 'Go there' } });
	});

	it('keeps an emptied slide number empty while it is retyped', async () => {
		const wrapper = mount(HyperlinkDialog, {
			props: {
				open: true,
				element: element({ action: 'ppaction://hlinksldjump', targetSlideIndex: 2 }),
			},
			attachTo: document.body,
		});
		const slide = document.body.querySelector<HTMLInputElement>(
			'input[aria-label="Slide number"]',
		)!;
		slide.value = '';
		slide.dispatchEvent(new Event('input'));
		await wrapper.vm.$nextTick();
		expect(slide.value).toBe('');
	});

	it('prefills a slide-jump action on the Slide target', () => {
		mount(HyperlinkDialog, {
			props: {
				open: true,
				element: element({ action: 'ppaction://hlinksldjump', targetSlideIndex: 2 }),
			},
			attachTo: document.body,
		});
		const pressed = Array.from(document.body.querySelectorAll('button[aria-pressed="true"]'));
		expect(pressed.map((b) => b.textContent?.trim())).toStrictEqual(['Slide']);
		const slide = document.body.querySelector<HTMLInputElement>('input[aria-label="Slide number"]');
		expect(slide?.value).toBe('3');
	});
});
