/**
 * The Insert > Link dialog's targets, shared by every binding: a web address, an email address
 * with a subject, a slide of this deck, a file, or a show jump (first, last, next or previous
 * slide, end show). DOM-free.
 *
 * A dialog seeds its fields from the element's `actionClick` ({@link seedHyperlinkEditDraft}) and
 * hands the edited fields back to {@link buildHyperlinkEditPatch}, which builds the action afresh
 * for a new target: a slide or a show jump through core's `elementActionToPptxAction`, so it
 * carries no address or relationship id from the old target, and the save resolves the slide's
 * part from its index. The action's own settings (highlight on click, the click sound) stay, and a
 * target left as it was keeps its action as loaded, so an action no tab shows (a custom show, an
 * OLE verb) survives Apply. {@link hyperlinkEditFields} lists each tab's fields for the templates.
 *
 * @module render/hyperlink-edit-target
 */
import { elementActionToPptxAction, pptxActionToElementAction } from 'ooxml-core/pptx';
import type { PptxAction, PptxElement } from 'ooxml-core/pptx';

import { isUrlSafe } from './hyperlink-security';

/** What a link points at, one tab of the dialog each. */
export type HyperlinkTargetType = 'url' | 'email' | 'slide' | 'file' | 'action';

/** The show jumps a link can make. */
export type HyperlinkActionVerb =
	| 'nextSlide'
	| 'prevSlide'
	| 'firstSlide'
	| 'lastSlide'
	| 'endShow';

/** The dialog's tabs in order, with their labels. */
export const HYPERLINK_TARGET_TYPES: readonly { type: HyperlinkTargetType; labelKey: string }[] = [
	{ type: 'url', labelKey: 'pptx.hyperlink.tabUrl' },
	{ type: 'email', labelKey: 'pptx.hyperlink.tabEmail' },
	{ type: 'slide', labelKey: 'pptx.hyperlink.tabSlide' },
	{ type: 'file', labelKey: 'pptx.hyperlink.tabFile' },
	{ type: 'action', labelKey: 'pptx.hyperlink.tabAction' },
];

/** The show jumps in menu order, with their labels. */
export const HYPERLINK_ACTION_VERBS: readonly { verb: HyperlinkActionVerb; labelKey: string }[] = [
	{ verb: 'nextSlide', labelKey: 'pptx.hyperlink.actionNextSlide' },
	{ verb: 'prevSlide', labelKey: 'pptx.hyperlink.actionPrevSlide' },
	{ verb: 'firstSlide', labelKey: 'pptx.hyperlink.actionFirstSlide' },
	{ verb: 'lastSlide', labelKey: 'pptx.hyperlink.actionLastSlide' },
	{ verb: 'endShow', labelKey: 'pptx.hyperlink.actionEndShow' },
];

/** A field of the dialog, named as in {@link HyperlinkEditDraft}. */
export type HyperlinkEditFieldName =
	| 'url'
	| 'emailAddress'
	| 'emailSubject'
	| 'slideNumber'
	| 'filePath'
	| 'actionVerb'
	| 'tooltip';

/**
 * One field of a tab, for a template to map: its label (also its accessible name), and the
 * control, an `<input>` of that type or a `<select>` of {@link HYPERLINK_ACTION_VERBS}.
 */
export interface HyperlinkEditField {
	name: HyperlinkEditFieldName;
	labelKey: string;
	control: 'url' | 'email' | 'text' | 'number' | 'select';
	placeholder?: string;
}

const TOOLTIP_FIELD: HyperlinkEditField = {
	name: 'tooltip',
	labelKey: 'pptx.hyperlink.tooltipLabel',
	control: 'text',
};

const TARGET_FIELDS: Record<HyperlinkTargetType, readonly HyperlinkEditField[]> = {
	url: [
		{
			name: 'url',
			labelKey: 'pptx.hyperlink.urlLabel',
			control: 'url',
			placeholder: 'https://example.com',
		},
	],
	email: [
		{
			name: 'emailAddress',
			labelKey: 'pptx.hyperlink.emailLabel',
			control: 'email',
			placeholder: 'user@example.com',
		},
		{ name: 'emailSubject', labelKey: 'pptx.hyperlink.subjectLabel', control: 'text' },
	],
	slide: [{ name: 'slideNumber', labelKey: 'pptx.hyperlink.slideLabel', control: 'number' }],
	file: [
		{
			name: 'filePath',
			labelKey: 'pptx.hyperlink.fileLabel',
			control: 'text',
			placeholder: '../documents/file.docx',
		},
	],
	action: [{ name: 'actionVerb', labelKey: 'pptx.hyperlink.actionLabel', control: 'select' }],
};

/** The fields a target's tab shows, the screen tip (which every target has) last. */
export function hyperlinkEditFields(type: HyperlinkTargetType): readonly HyperlinkEditField[] {
	return [...TARGET_FIELDS[type], TOOLTIP_FIELD];
}

/** The dialog's fields. `slideNumber` is 1-based, as the field shows it. */
export interface HyperlinkEditDraft {
	targetType: HyperlinkTargetType;
	url: string;
	tooltip: string;
	emailAddress: string;
	emailSubject: string;
	slideNumber: number;
	filePath: string;
	actionVerb: HyperlinkActionVerb;
}

const VERBS = new Set<string>(HYPERLINK_ACTION_VERBS.map(({ verb }) => verb));

/**
 * The draft with one field set from its control's text: a slide number that is not one reads as
 * slide 1, and a show jump that is not one of {@link HYPERLINK_ACTION_VERBS} leaves the field.
 */
export function setHyperlinkEditField(
	draft: HyperlinkEditDraft,
	name: HyperlinkEditFieldName,
	value: string,
): HyperlinkEditDraft {
	if (name === 'slideNumber') {
		const slideNumber = Number.parseInt(value, 10);
		return { ...draft, slideNumber: slideNumber > 0 ? slideNumber : 1 };
	}
	if (name === 'actionVerb') {
		return VERBS.has(value) ? { ...draft, actionVerb: value as HyperlinkActionVerb } : draft;
	}
	return { ...draft, [name]: value };
}

/** Whether the element links anywhere (Remove link shows), a slide jump made in the editor included. */
export function hasHyperlinkEditTarget(element: PptxElement | null | undefined): boolean {
	const action = element?.actionClick;
	return Boolean(action?.url || action?.action);
}

/** A Windows or relative path, or a `file:` URI: the File tab's kind of address. */
function isFilePath(url: string): boolean {
	return /^[a-zA-Z]:\\|^\.\.?[/\\]|^file:/iu.test(url);
}

/** A `mailto:` address split into the address and its subject. */
export function parseEmailUrl(url: string): { address: string; subject: string } {
	if (!url.startsWith('mailto:')) {
		return { address: url, subject: '' };
	}
	const rest = url.slice('mailto:'.length);
	const query = rest.indexOf('?');
	if (query < 0) {
		return { address: rest, subject: '' };
	}
	const subject = new URLSearchParams(rest.slice(query + 1)).get('subject') ?? '';
	return { address: rest.slice(0, query), subject };
}

/** Which tab an element's click action opens on. */
export function detectHyperlinkTargetType(action: PptxAction | undefined): HyperlinkTargetType {
	if (!action) {
		return 'url';
	}
	const type = pptxActionToElementAction(action, 'click').type;
	if (type === 'slide') {
		return 'slide';
	}
	if (VERBS.has(type)) {
		return 'action';
	}
	const url = action.url ?? '';
	if (url.startsWith('mailto:')) {
		return 'email';
	}
	return isFilePath(url) ? 'file' : 'url';
}

/** The dialog's fields for an element's click action (empty fields when it has none). */
export function seedHyperlinkEditDraft(action: PptxAction | undefined): HyperlinkEditDraft {
	const targetType = detectHyperlinkTargetType(action);
	const url = action?.url ?? '';
	const email = targetType === 'email' ? parseEmailUrl(url) : { address: '', subject: '' };
	const verb = action ? pptxActionToElementAction(action, 'click').type : undefined;
	return {
		targetType,
		url: targetType === 'url' ? url : '',
		tooltip: action?.tooltip ?? '',
		emailAddress: email.address,
		emailSubject: email.subject,
		slideNumber:
			targetType === 'slide' && typeof action?.targetSlideIndex === 'number'
				? action.targetSlideIndex + 1
				: 1,
		filePath: targetType === 'file' ? url : '',
		actionVerb: verb && VERBS.has(verb) ? (verb as HyperlinkActionVerb) : 'nextSlide',
	};
}

/** The draft's target fields, trimmed: two drafts with the same key point at the same target. */
function targetKey(draft: HyperlinkEditDraft): string {
	switch (draft.targetType) {
		case 'email':
			return `email:${draft.emailAddress.trim()}?${draft.emailSubject.trim()}`;
		case 'slide':
			return `slide:${draft.slideNumber}`;
		case 'action':
			return `action:${draft.actionVerb}`;
		case 'file':
			return `file:${draft.filePath.trim()}`;
		case 'url':
		default:
			return `url:${draft.url.trim()}`;
	}
}

/** The new target's own part of the action, or `null` when the draft names none. */
function targetAction(
	draft: HyperlinkEditDraft,
	slideCount: number | undefined,
): PptxAction | null {
	switch (draft.targetType) {
		case 'email': {
			const address = draft.emailAddress.trim();
			if (!address) {
				return null;
			}
			const subject = draft.emailSubject.trim();
			return {
				url: subject
					? `mailto:${address}?subject=${encodeURIComponent(subject)}`
					: `mailto:${address}`,
			};
		}
		case 'slide': {
			const last = slideCount && slideCount > 0 ? slideCount - 1 : Number.POSITIVE_INFINITY;
			const slideIndex = Math.min(last, Math.max(0, Math.trunc(draft.slideNumber) - 1));
			return elementActionToPptxAction({ trigger: 'click', type: 'slide', slideIndex }) ?? null;
		}
		case 'action':
			return elementActionToPptxAction({ trigger: 'click', type: draft.actionVerb }) ?? null;
		case 'file': {
			const path = draft.filePath.trim();
			return path ? { url: path } : null;
		}
		case 'url':
		default: {
			const url = draft.url.trim();
			return url ? { url } : null;
		}
	}
}

/**
 * The patch that applies the dialog's fields to `element`, or `undefined` when there is nothing to
 * apply: the fields are the ones the element has, or the address is one `isUrlSafe` blocks
 * (`javascript:` and the like). A target left as it was keeps the action as loaded (its
 * relationship id included) with the new screen tip; a new one is built afresh, and an empty one
 * removes the link (`{ actionClick: undefined }`). `slideCount` keeps a slide jump inside the deck.
 */
export function buildHyperlinkEditPatch(
	element: PptxElement,
	draft: HyperlinkEditDraft,
	slideCount?: number,
): Partial<PptxElement> | undefined {
	const current = element.actionClick;
	const tooltip = draft.tooltip.trim();
	if (targetKey(draft) === targetKey(seedHyperlinkEditDraft(current))) {
		if (!current || tooltip === (current.tooltip ?? '')) {
			return undefined;
		}
		const { tooltip: _old, ...kept } = current;
		return { actionClick: { ...kept, ...(tooltip ? { tooltip } : {}) } };
	}
	const target = targetAction(draft, slideCount);
	if (!target) {
		return { actionClick: undefined };
	}
	if (target.url && !isUrlSafe(target.url)) {
		return undefined;
	}
	const { highlightClick, endSnd, soundRId, soundPath } = current ?? {};
	const actionClick: PptxAction = {
		...target,
		...(tooltip ? { tooltip } : {}),
		...(highlightClick ? { highlightClick } : {}),
		...(endSnd ? { endSnd } : {}),
		...(soundRId ? { soundRId } : {}),
		...(soundPath ? { soundPath } : {}),
	};
	return { actionClick };
}
