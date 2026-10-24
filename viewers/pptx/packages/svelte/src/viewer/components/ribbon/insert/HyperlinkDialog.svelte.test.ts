import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EditorState } from '../../../editor/editor-state.svelte';
import { allButtons, footerAction } from '../../dialog-footer.test-support';
import HyperlinkDialog from './HyperlinkDialog.svelte';

/**
 * HyperlinkDialog tests. Named `*.svelte.test.ts` (not plain `.test.ts`) per
 * the repo convention for mounting a Svelte 5 component with `mount()`.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
	cleanup?.();
	cleanup = undefined;
});

function makeEditor(): EditorState {
	const editor = new EditorState({ getCurrent: () => 0, getHandler: () => null });
	editor.editable = true;
	editor.setSlides([
		{
			id: 's1',
			rId: 'rId1',
			slideNumber: 1,
			elements: [{ id: 'el1', type: 'shape', x: 0, y: 0, width: 100, height: 50 }],
		},
	]);
	editor.select('el1');
	return editor;
}

function mountDialog(editor: EditorState, onclose: () => void): HTMLElement {
	const target = document.createElement('div');
	document.body.appendChild(target);
	// `target` must exist (and be appended) before `mount()` is called, so this
	// declaration can't merge with the one above without reordering the setup.
	// eslint-disable-next-line one-var
	const instance = mount(HyperlinkDialog, { target, props: { editor, onclose } });
	flushSync();
	cleanup = () => {
		unmount(instance);
		target.remove();
	};
	return target;
}

function fillAndSave(target: HTMLElement, url: string): void {
	const urlInput = target.querySelector<HTMLInputElement>('input[type="url"]');
	if (!urlInput) {
		throw new Error('url input not found');
	}
	urlInput.value = url;
	urlInput.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	// `okButton` is read after typing into `urlInput` and flushing, so this
	// declaration can't merge with the one above without reordering the setup.
	// eslint-disable-next-line one-var
	const okButton = allButtons(target.querySelector('footer')!).at(-1);
	okButton?.click();
	flushSync();
}

describe('hyperlinkDialog', () => {
	it('saves a safe URL as the element actionClick', () => {
		const editor = makeEditor(),
			onclose = vi.fn(),
			target = mountDialog(editor, onclose);

		fillAndSave(target, 'https://example.com');

		expect(editor.slides[0]?.elements[0]?.actionClick?.url).toBe('https://example.com');
		expect(onclose).toHaveBeenCalledOnce();
	});

	it('blocks an unsafe URL scheme (javascript:) and does not persist it', () => {
		const editor = makeEditor(),
			onclose = vi.fn(),
			target = mountDialog(editor, onclose);

		fillAndSave(target, `${'javascript'}:alert(1)`);

		expect(editor.slides[0]?.elements[0]?.actionClick?.url).toBeUndefined();
		expect(onclose).toHaveBeenCalledOnce();
	});

	it('blocks other unsafe schemes (data:, vbscript:) as well', () => {
		const editor = makeEditor(),
			target1 = mountDialog(editor, vi.fn());
		fillAndSave(target1, 'data:text/html,<script>alert(1)</script>');
		expect(editor.slides[0]?.elements[0]?.actionClick?.url).toBeUndefined();
		cleanup?.();
		cleanup = undefined;

		// `target2` is mounted only after the first dialog instance is torn down
		// above, so this declaration can't merge with the one above.
		// eslint-disable-next-line one-var
		const target2 = mountDialog(editor, vi.fn());
		fillAndSave(target2, 'vbscript:msgbox(1)');
		expect(editor.slides[0]?.elements[0]?.actionClick?.url).toBeUndefined();
	});

	it('keeps the existing link when a blocked address is typed', () => {
		const editor = makeEditor();
		editor.applyElementPatch('el1', { actionClick: { url: 'https://example.com' } });
		// `target` is mounted only after seeding the existing link above.
		// eslint-disable-next-line one-var
		const target = mountDialog(editor, vi.fn());

		fillAndSave(target, `${'javascript'}:alert(1)`);

		expect(editor.slides[0]?.elements[0]?.actionClick).toStrictEqual({
			url: 'https://example.com',
		});
	});

	it('links to a slide through the Slide tab, by its place in the deck', () => {
		const editor = makeEditor();
		editor.setSlides([
			...editor.slides,
			{ id: 's2', rId: 'rId2', slideNumber: 2, elements: [] },
			{ id: 's3', rId: 'rId3', slideNumber: 3, elements: [] },
		]);
		editor.select('el1');
		// `target` is mounted only after the deck has its three slides.
		// eslint-disable-next-line one-var
		const target = mountDialog(editor, vi.fn()),
			slideTab = Array.from(
				target.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'),
			).find((b) => b.textContent?.trim() === 'Slide');
		slideTab?.click();
		flushSync();
		const slide = target.querySelector<HTMLInputElement>('input[aria-label="Slide number"]');
		if (!slide) {
			throw new Error('slide number field not found');
		}
		slide.value = '3';
		slide.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		allButtons(target.querySelector('footer')!).at(-1)?.click();
		flushSync();

		expect(editor.slides[0]?.elements[0]?.actionClick).toStrictEqual({
			action: 'ppaction://hlinksldjump',
			targetSlideIndex: 2,
		});
	});

	it('keeps an emptied slide number empty while it is retyped', () => {
		const editor = makeEditor();
		editor.applyElementPatch('el1', {
			actionClick: { action: 'ppaction://hlinksldjump', targetSlideIndex: 2 },
		});
		// `target` is mounted only after seeding the jump above.
		// eslint-disable-next-line one-var
		const target = mountDialog(editor, vi.fn()),
			slide = target.querySelector<HTMLInputElement>('input[aria-label="Slide number"]')!;
		slide.value = '';
		slide.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();

		expect(slide.value).toBe('');
	});

	it('offers Remove link for a slide jump made in the editor', () => {
		const editor = makeEditor();
		editor.applyElementPatch('el1', {
			actionClick: { action: 'ppaction://hlinksldjump', targetSlideIndex: 0 },
		});
		// `target` is mounted only after seeding the jump above.
		// eslint-disable-next-line one-var
		const target = mountDialog(editor, vi.fn());

		expect(footerAction(target, 'remove')).toBeTruthy();
	});

	it('shows a Remove Link button only when the element already has a link, and clears it on click', () => {
		const editor = makeEditor();
		editor.applyElementPatch('el1', { actionClick: { url: 'https://example.com' } });
		// `target` is mounted only after seeding the existing link above, so this
		// declaration can't merge with the one above.
		// eslint-disable-next-line one-var
		const target = mountDialog(editor, vi.fn()),
			removeButton = footerAction(target, 'remove');

		expect(removeButton).not.toBeNull();
		removeButton?.click();
		flushSync();

		expect(editor.slides[0]?.elements[0]?.actionClick).toBeUndefined();
	});
});
