import {
	HYPERLINK_ACTION_VERBS,
	HYPERLINK_TARGET_TYPES,
	buildClearHyperlinkPatch,
	buildHyperlinkEditPatch,
	hasHyperlinkEditTarget,
	hyperlinkEditFields,
	seedHyperlinkEditDraft,
	setHyperlinkEditField,
} from 'ooxml-ui/pptx';
import type { HyperlinkEditField } from 'ooxml-ui/pptx';
import type { PptxElement } from 'pptx-viewer-core';

import type { Translator } from '../i18n';
import { createEl } from '../render';
import { appendDialogActions } from './dialog-footer';
import { createParityDialogShell } from './parity-dialog-shell';
import type { RegionSet } from './region-set';

/**
 * Insert > Link. The targets (a web address, an email address, a slide of this deck, a file, or a
 * show jump), each tab's fields and the patch they make are the shared model in `ooxml-ui/pptx`
 * (`hyperlink-edit-target`), as in every binding. `onApply` gets no call when there is nothing to
 * apply (the fields are unchanged, or the address is one the URL guard blocks).
 */
export function openHyperlinkEditDialog(
	doc: Document,
	t: Translator,
	element: PptxElement,
	onApply: (patch: Partial<PptxElement>) => void,
	/** The viewer's dialog regions: the dialog closes with the viewer. */
	regions?: RegionSet,
	/** The deck's slide count: the Slide field's bounds, and a slide jump stays inside the deck. */
	slideCount?: number,
): void {
	const shell = createParityDialogShell(
		doc,
		t,
		t('pptx.hyperlink.editTitle'),
		regions && { regions },
	);
	let draft = seedHyperlinkEditDraft(element.actionClick);
	// The controls on screen and the fields they edit: read back into the draft on a tab switch
	// and on Apply, so a value set without an input event still counts.
	let shown: { field: HyperlinkEditField; control: HTMLInputElement | HTMLSelectElement }[] = [];
	const readControls = (): void => {
		for (const { field, control } of shown) {
			draft = setHyperlinkEditField(draft, field.name, control.value);
		}
	};
	const apply = (): void => {
		readControls();
		const patch = buildHyperlinkEditPatch(element, draft, slideCount);
		if (patch) {
			onApply(patch);
		}
		shell.close();
	};

	const tabs = createEl(doc, 'div', 'pptxv-parity-tabs');
	const fields = createEl(doc, 'div', 'pptxv-parity-body-fields');
	const tabButtons = HYPERLINK_TARGET_TYPES.map(({ type, labelKey }) => {
		const button = createEl(doc, 'button');
		button.type = 'button';
		button.textContent = t(labelKey);
		button.addEventListener('click', () => {
			readControls();
			draft = { ...draft, targetType: type };
			render();
		});
		tabs.appendChild(button);
		return { type, button };
	});
	shell.body.append(tabs, fields);

	const control = (field: HyperlinkEditField): HTMLInputElement | HTMLSelectElement => {
		const label = t(field.labelKey);
		if (field.control === 'select') {
			const select = createEl(doc, 'select');
			for (const { verb, labelKey } of HYPERLINK_ACTION_VERBS) {
				const option = createEl(doc, 'option');
				option.value = verb;
				option.textContent = t(labelKey);
				select.appendChild(option);
			}
			select.value = draft.actionVerb;
			select.setAttribute('aria-label', label);
			return select;
		}
		const input = createEl(doc, 'input');
		input.type = field.control;
		input.value = String(draft[field.name]);
		input.setAttribute('aria-label', label);
		if (field.placeholder) {
			input.placeholder = field.placeholder;
		}
		if (field.control === 'number') {
			input.min = '1';
			if (slideCount) {
				input.max = String(slideCount);
			}
		}
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				apply();
			}
		});
		return input;
	};

	function render(): void {
		for (const { type, button } of tabButtons) {
			button.setAttribute('aria-pressed', String(draft.targetType === type));
			button.classList.toggle('is-active', draft.targetType === type);
		}
		shown = hyperlinkEditFields(draft.targetType).map((field) => ({
			field,
			control: control(field),
		}));
		fields.replaceChildren(
			...shown.map(({ field, control: input }) => {
				const row = createEl(doc, 'label', 'pptxv-parity-select');
				const caption = createEl(doc, 'span');
				caption.textContent = t(field.labelKey);
				row.append(caption, input);
				if (field.name === 'slideNumber' && slideCount) {
					const hint = createEl(doc, 'small');
					hint.textContent = t('pptx.hyperlink.slideRange', { max: slideCount });
					row.appendChild(hint);
				}
				return row;
			}),
		);
	}
	render();

	appendDialogActions(doc, shell.footer, [
		...(hasHyperlinkEditTarget(element)
			? [
					{
						id: 'remove',
						label: t('pptx.hyperlinkDialog.removeLink'),
						align: 'start' as const,
						run: () => {
							onApply(buildClearHyperlinkPatch());
							shell.close();
						},
					},
				]
			: []),
		{ id: 'cancel', label: t('pptx.common.cancel'), run: shell.close },
		{ id: 'apply', label: t('pptx.hyperlinkDialog.apply'), variant: 'primary', run: apply },
	]);
}
