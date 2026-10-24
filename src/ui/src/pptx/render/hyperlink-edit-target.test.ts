import type { PptxAction, PptxElement } from 'ooxml-core/pptx';
import { describe, expect, it } from 'vitest';

import {
	HYPERLINK_ACTION_VERBS,
	buildHyperlinkEditPatch,
	detectHyperlinkTargetType,
	hasHyperlinkEditTarget,
	hyperlinkEditFieldText,
	hyperlinkEditFields,
	parseEmailUrl,
	seedHyperlinkEditDraft,
	setHyperlinkEditField,
} from './hyperlink-edit-target';
import type { HyperlinkEditDraft } from './hyperlink-edit-target';

const element = (actionClick?: PptxAction): PptxElement =>
	({ id: 'e1', type: 'shape', x: 0, y: 0, width: 10, height: 10, actionClick }) as PptxElement;

const draft = (fields: Partial<HyperlinkEditDraft>): HyperlinkEditDraft => ({
	targetType: 'url',
	url: '',
	tooltip: '',
	emailAddress: '',
	emailSubject: '',
	slideNumber: 1,
	filePath: '',
	actionVerb: 'nextSlide',
	...fields,
});

const JUMP = 'ppaction://hlinksldjump';

describe('detectHyperlinkTargetType', () => {
	it('tells each target from the loaded action', () => {
		expect(detectHyperlinkTargetType(undefined)).toBe('url');
		expect(detectHyperlinkTargetType({ url: 'https://example.com' })).toBe('url');
		expect(detectHyperlinkTargetType({ url: 'mailto:a@b.c?subject=Hi' })).toBe('email');
		expect(detectHyperlinkTargetType({ url: 'C:\\reports\\q1.docx' })).toBe('file');
		expect(detectHyperlinkTargetType({ url: './q1.docx' })).toBe('file');
		expect(detectHyperlinkTargetType({ url: '../q1.docx' })).toBe('file');
		expect(detectHyperlinkTargetType({ url: 'file:///tmp/q1.docx' })).toBe('file');
		expect(
			detectHyperlinkTargetType({ action: JUMP, url: 'slide3.xml', targetSlideIndex: 2 }),
		).toBe('slide');
		expect(detectHyperlinkTargetType({ action: 'ppaction://hlinkshowjump?jump=lastslide' })).toBe(
			'action',
		);
	});
});

describe('parseEmailUrl', () => {
	it('splits the address and the subject', () => {
		expect(parseEmailUrl('mailto:a@b.c')).toStrictEqual({ address: 'a@b.c', subject: '' });
		expect(parseEmailUrl('mailto:a@b.c?subject=Q1%20review&cc=d@e.f')).toStrictEqual({
			address: 'a@b.c',
			subject: 'Q1 review',
		});
		expect(parseEmailUrl('mailto:?subject=Hi')).toStrictEqual({ address: '', subject: 'Hi' });
		expect(parseEmailUrl('a@b.c')).toStrictEqual({ address: 'a@b.c', subject: '' });
		expect(parseEmailUrl('')).toStrictEqual({ address: '', subject: '' });
	});
});

describe('seedHyperlinkEditDraft', () => {
	it('fills the fields of the target the action has', () => {
		expect(seedHyperlinkEditDraft(undefined)).toStrictEqual(draft({}));
		expect(seedHyperlinkEditDraft({ url: 'https://example.com', tooltip: 'Open' })).toStrictEqual(
			draft({ url: 'https://example.com', tooltip: 'Open' }),
		);
		expect(seedHyperlinkEditDraft({ url: 'mailto:a@b.c?subject=Hi' })).toStrictEqual(
			draft({ targetType: 'email', emailAddress: 'a@b.c', emailSubject: 'Hi' }),
		);
		expect(seedHyperlinkEditDraft({ url: 'C:\\q1.docx' })).toStrictEqual(
			draft({ targetType: 'file', filePath: 'C:\\q1.docx' }),
		);
		expect(
			seedHyperlinkEditDraft({ action: 'ppaction://hlinkshowjump?jump=endshow' }),
		).toStrictEqual(draft({ targetType: 'action', actionVerb: 'endShow' }));
	});

	it("shows a slide jump's slide by its place in the deck, not its part name", () => {
		// The loader reads the jump's part into a deck index; after a reorder `slide5.xml` is slide 2.
		const loaded = { action: JUMP, rId: 'rId3', url: 'slide5.xml', targetSlideIndex: 1 };
		expect(seedHyperlinkEditDraft(loaded)).toStrictEqual(
			draft({ targetType: 'slide', slideNumber: 2 }),
		);
	});
});

describe('buildHyperlinkEditPatch', () => {
	const loaded = element({
		rId: 'rId2',
		url: 'https://example.com/old',
		tooltip: 'Old',
		highlightClick: true,
		soundRId: 'rId9',
		soundPath: '../media/click.wav',
	});

	it('builds each target afresh, keeping the action settings', () => {
		const kept = { highlightClick: true, soundRId: 'rId9', soundPath: '../media/click.wav' };
		expect(
			buildHyperlinkEditPatch(loaded, draft({ url: ' https://example.org/new ', tooltip: ' ' })),
		).toStrictEqual({ actionClick: { url: 'https://example.org/new', ...kept } });
		expect(
			buildHyperlinkEditPatch(
				loaded,
				draft({ targetType: 'email', emailAddress: 'a@b.c', emailSubject: 'Q1 review' }),
			),
		).toStrictEqual({ actionClick: { url: 'mailto:a@b.c?subject=Q1%20review', ...kept } });
		// A slide jump by index only: no address or relationship id from the old target.
		expect(
			buildHyperlinkEditPatch(
				loaded,
				draft({ targetType: 'slide', slideNumber: 3, tooltip: 'Go' }),
			),
		).toStrictEqual({ actionClick: { action: JUMP, targetSlideIndex: 2, tooltip: 'Go', ...kept } });
		expect(
			buildHyperlinkEditPatch(loaded, draft({ targetType: 'action', actionVerb: 'firstSlide' })),
		).toStrictEqual({
			actionClick: { action: 'ppaction://hlinkshowjump?jump=firstslide', ...kept },
		});
		expect(
			buildHyperlinkEditPatch(loaded, draft({ targetType: 'file', filePath: 'C:\\q1.docx' })),
		).toStrictEqual({ actionClick: { url: 'C:\\q1.docx', ...kept } });
	});

	it('removes the link for an empty target and applies nothing for a blocked address', () => {
		expect(buildHyperlinkEditPatch(loaded, draft({ url: '  ' }))).toStrictEqual({
			actionClick: undefined,
		});
		expect(buildHyperlinkEditPatch(loaded, draft({ targetType: 'email' }))).toStrictEqual({
			actionClick: undefined,
		});
		// oxlint-disable-next-line eslint/no-script-url -- the blocked scheme under test
		expect(buildHyperlinkEditPatch(loaded, draft({ url: 'javascript:alert(1)' }))).toBeUndefined();
		expect(
			buildHyperlinkEditPatch(loaded, draft({ targetType: 'file', filePath: 'data:text/html,x' })),
		).toBeUndefined();
	});

	it('keeps a target the dialog did not change as loaded, editing only the screen tip', () => {
		// Apply with nothing changed applies nothing (no undo step, the relationship id stays).
		expect(
			buildHyperlinkEditPatch(loaded, seedHyperlinkEditDraft(loaded.actionClick)),
		).toBeUndefined();
		const show = element({ action: 'ppaction://customshow?id=0&return=true', tooltip: 'Old' });
		// A custom show is no tab of the dialog: it opens on an empty address, and Apply keeps it.
		expect(seedHyperlinkEditDraft(show.actionClick)).toStrictEqual(draft({ tooltip: 'Old' }));
		expect(buildHyperlinkEditPatch(show, draft({ tooltip: 'Old' }))).toBeUndefined();
		expect(buildHyperlinkEditPatch(show, draft({ tooltip: ' New ' }))).toStrictEqual({
			actionClick: { action: 'ppaction://customshow?id=0&return=true', tooltip: 'New' },
		});
		expect(
			buildHyperlinkEditPatch(loaded, draft({ url: 'https://example.com/old' })),
		).toStrictEqual({
			actionClick: {
				rId: 'rId2',
				url: 'https://example.com/old',
				highlightClick: true,
				soundRId: 'rId9',
				soundPath: '../media/click.wav',
			},
		});
		// No link and an empty target: nothing to apply.
		expect(buildHyperlinkEditPatch(element(), draft({}))).toBeUndefined();
	});

	it('keeps a slide jump inside the deck', () => {
		const jump = (slideNumber: number) =>
			buildHyperlinkEditPatch(element(), draft({ targetType: 'slide', slideNumber }), 4)
				?.actionClick?.targetSlideIndex;
		expect([jump(0), jump(2), jump(4), jump(9)]).toStrictEqual([0, 1, 3, 3]);
	});

	it('round-trips every target through seed and patch', () => {
		for (const fields of [
			{ url: 'https://example.com' },
			{ targetType: 'email', emailAddress: 'a@b.c', emailSubject: 'Hi there' },
			{ targetType: 'slide', slideNumber: 4 },
			{ targetType: 'file', filePath: '../notes.docx' },
			...HYPERLINK_ACTION_VERBS.map(
				({ verb }) => ({ targetType: 'action', actionVerb: verb }) as const,
			),
		]) {
			const patch = buildHyperlinkEditPatch(element(), draft(fields));
			expect(seedHyperlinkEditDraft(patch?.actionClick)).toStrictEqual(draft(fields));
		}
	});
});

describe('hyperlinkEditFields', () => {
	it("lists each tab's fields with their labels, the screen tip last", () => {
		const names = (type: HyperlinkEditDraft['targetType']) =>
			hyperlinkEditFields(type).map(
				({ name, labelKey, control }) => `${name}:${labelKey}:${control}`,
			);
		expect(names('url')).toStrictEqual([
			'url:pptx.hyperlink.urlLabel:url',
			'tooltip:pptx.hyperlink.tooltipLabel:text',
		]);
		expect(names('email')).toStrictEqual([
			'emailAddress:pptx.hyperlink.emailLabel:email',
			'emailSubject:pptx.hyperlink.subjectLabel:text',
			'tooltip:pptx.hyperlink.tooltipLabel:text',
		]);
		expect(names('slide')).toStrictEqual([
			'slideNumber:pptx.hyperlink.slideLabel:number',
			'tooltip:pptx.hyperlink.tooltipLabel:text',
		]);
		expect(names('file')).toStrictEqual([
			'filePath:pptx.hyperlink.fileLabel:text',
			'tooltip:pptx.hyperlink.tooltipLabel:text',
		]);
		expect(names('action')).toStrictEqual([
			'actionVerb:pptx.hyperlink.actionLabel:select',
			'tooltip:pptx.hyperlink.tooltipLabel:text',
		]);
	});
});

describe('setHyperlinkEditField', () => {
	it("sets a field from its input's text", () => {
		expect(setHyperlinkEditField(draft({}), 'url', 'https://a.b')).toStrictEqual(
			draft({ url: 'https://a.b' }),
		);
		expect(setHyperlinkEditField(draft({}), 'slideNumber', '3').slideNumber).toBe(3);
		// An emptied slide number stays empty while it is retyped, and a patch then links to slide 1.
		const emptied = setHyperlinkEditField(draft({ slideNumber: 3 }), 'slideNumber', '');
		expect(hyperlinkEditFieldText(emptied, 'slideNumber')).toBe('');
		expect(hyperlinkEditFieldText(draft({ slideNumber: 3 }), 'slideNumber')).toBe('3');
		expect(
			buildHyperlinkEditPatch(element(), { ...emptied, targetType: 'slide' })?.actionClick
				?.targetSlideIndex,
		).toBe(0);
		// Slide 1 retyped as 0 or emptied is still the jump the element has: it stays as loaded.
		const jump = element({ action: JUMP, rId: 'rId3', url: 'slide1.xml', targetSlideIndex: 0 });
		for (const typed of ['0', '']) {
			const edited = setHyperlinkEditField(
				seedHyperlinkEditDraft(jump.actionClick),
				'slideNumber',
				typed,
			);
			expect(buildHyperlinkEditPatch(jump, edited, 4)).toBeUndefined();
		}
		expect(setHyperlinkEditField(draft({}), 'actionVerb', 'endShow').actionVerb).toBe('endShow');
		expect(setHyperlinkEditField(draft({}), 'actionVerb', 'bogus').actionVerb).toBe('nextSlide');
	});
});

describe('hasHyperlinkEditTarget', () => {
	it('tells whether the element links anywhere, a jump made in the editor included', () => {
		expect(hasHyperlinkEditTarget(null)).toBe(false);
		expect(hasHyperlinkEditTarget(element())).toBe(false);
		expect(hasHyperlinkEditTarget(element({ soundRId: 'rId9' }))).toBe(false);
		expect(hasHyperlinkEditTarget(element({ url: 'https://a.b' }))).toBe(true);
		expect(hasHyperlinkEditTarget(element({ action: JUMP, targetSlideIndex: 1 }))).toBe(true);
	});
});
