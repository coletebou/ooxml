import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import type { PptxAction, PptxElement } from 'pptx-viewer-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { translationsEn } from '../../../../../../src/ui/src/pptx/i18n';
import { registerPptxWebControls } from '../../../../../../src/ui/src/pptx/web-components';
import { DialogFooterComponent } from './dialog-footer.component';
import { DialogFooterStub, ModalFrameStub } from './dialog-frame-stubs.test-support';
import { HyperlinkDialogComponent } from './hyperlink-dialog.component';
import { ModalDialogComponent } from './modal-dialog.component';

beforeAll(() => {
	TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
	registerPptxWebControls();
});
afterEach(() => {
	TestBed.resetTestingModule();
	document.body.replaceChildren();
});

const element = (actionClick?: PptxAction) =>
	({ id: 'e1', type: 'shape', x: 0, y: 0, width: 10, height: 10, actionClick }) as PptxElement;

const JUMP = 'ppaction://hlinksldjump';

function mount(el: PptxElement) {
	TestBed.configureTestingModule({
		imports: [HyperlinkDialogComponent],
		providers: [provideTranslateService({ fallbackLang: 'en' })],
	});
	// The Vitest JIT build wires no signal inputs: declare them, hand each a plain signal, and
	// stand in for the composed modal and footer, whose required inputs it cannot wire either.
	TestBed.overrideComponent(HyperlinkDialogComponent, {
		remove: { imports: [ModalDialogComponent, DialogFooterComponent] },
		add: { imports: [ModalFrameStub, DialogFooterStub], inputs: ['open', 'element', 'slideCount'] },
	});
	const fixture = TestBed.createComponent(HyperlinkDialogComponent);
	const open = signal(true);
	const current = signal(el);
	fixture.componentRef.setInput('open', open);
	fixture.componentRef.setInput('element', current);
	fixture.componentRef.setInput('slideCount', signal(4));
	const translate = TestBed.inject(TranslateService);
	translate.setTranslation('en', translationsEn);
	translate.use('en');
	fixture.detectChanges();
	const saved: unknown[] = [];
	fixture.componentInstance.save.subscribe((patch) => saved.push(patch));
	const root = fixture.nativeElement as HTMLElement;
	return {
		fixture,
		saved,
		reopen(next: PptxElement) {
			open.set(false);
			fixture.detectChanges();
			current.set(next);
			open.set(true);
			fixture.detectChanges();
		},
		field: (label: string) => root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`),
		pressed: () =>
			Array.from(root.querySelectorAll('button[aria-pressed="true"]')).map((b) =>
				b.textContent?.trim(),
			),
		tab(label: string) {
			Array.from(root.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'))
				.find((b) => b.textContent?.trim() === label)!
				.click();
			fixture.detectChanges();
		},
		type(label: string, value: string) {
			const input = root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
			input.value = value;
			input.dispatchEvent(new Event('input'));
			fixture.detectChanges();
		},
	};
}

describe('hyperlinkDialogComponent', () => {
	it('opens on the target the element has, its fields named by their labels', () => {
		const dialog = mount(element({ url: 'mailto:a@b.c?subject=Hi', tooltip: 'Mail' }));
		expect(dialog.pressed()).toStrictEqual(['Email']);
		expect(dialog.field('Email address')?.value).toBe('a@b.c');
		expect(dialog.field('Subject')?.value).toBe('Hi');
		expect(dialog.field('Screen tip')?.value).toBe('Mail');

		dialog.reopen(element({ action: JUMP, url: 'slide5.xml', targetSlideIndex: 1 }));
		expect(dialog.pressed()).toStrictEqual(['Slide']);
		expect(dialog.field('Slide number')?.value).toBe('2');
	});

	it('links to a slide through the Slide tab, inside the deck', () => {
		const dialog = mount(element());
		dialog.tab('Slide');
		dialog.type('Slide number', '9');
		dialog.fixture.componentInstance.apply();
		expect(dialog.saved).toStrictEqual([{ actionClick: { action: JUMP, targetSlideIndex: 3 } }]);
	});

	it('keeps an emptied slide number empty while it is retyped', () => {
		const dialog = mount(element({ action: JUMP, targetSlideIndex: 2 }));
		dialog.type('Slide number', '');
		expect(dialog.field('Slide number')?.value).toBe('');
	});

	it('applies nothing for a blocked address or unchanged fields', () => {
		const dialog = mount(element({ rId: 'rId2', url: 'https://existing.test' }));
		dialog.fixture.componentInstance.apply();
		dialog.type('Address', `${'javascript'}:alert(1)`);
		dialog.fixture.componentInstance.apply();
		expect(dialog.saved).toStrictEqual([]);
	});

	it('offers Remove link for any link, a slide jump made in the editor included', () => {
		const dialog = mount(element({ action: JUMP, targetSlideIndex: 1 }));
		expect(dialog.fixture.componentInstance.hasLink()).toBeTruthy();
		dialog.fixture.componentInstance.clear();
		expect(dialog.saved).toStrictEqual([{ actionClick: undefined }]);
	});
});
