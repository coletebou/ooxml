import { HYPERLINK_ACTION_VERBS, hyperlinkEditFieldText, hyperlinkEditFields } from 'ooxml-ui/pptx';
import type { HyperlinkEditDraft, HyperlinkEditFieldName } from 'ooxml-ui/pptx';
import React from 'react';

import { useTranslation } from '../i18n/use-translation';
import { WebSelect } from './WebControls';

/**
 * Props for the {@link HyperlinkTabContent} component.
 *
 * The fields are lifted to the parent {@link HyperlinkEditDialog} to keep the tab body stateless.
 */
export interface HyperlinkTabContentProps {
	draft: HyperlinkEditDraft;
	/** Set one field from its control's text. */
	setField: (name: HyperlinkEditFieldName, value: string) => void;
	slideCount: number;
	inputRef: React.RefObject<HTMLInputElement | null>;
	inputCls: string;
	onEnterConfirm: () => void;
}

/**
 * Renders the active tab's fields, the shared `hyperlinkEditFields` list: an address, an email
 * address and subject, a slide number, a file path or a show jump, then the screen tip. Each
 * control is named by its label.
 *
 * @param props - {@link HyperlinkTabContentProps}
 * @returns The rendered tab content.
 */
export function HyperlinkTabContent({
	draft,
	setField,
	slideCount,
	inputRef,
	inputCls,
	onEnterConfirm,
}: HyperlinkTabContentProps): React.ReactElement {
	const { t } = useTranslation();

	const handleEnterKey = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter') {
			onEnterConfirm();
		}
	};

	return (
		<div className='px-4 py-3 space-y-3'>
			{hyperlinkEditFields(draft.targetType).map((field, index) => {
				const label = t(field.labelKey);
				return (
					<div key={field.name}>
						<label className='block text-xs text-muted-foreground mb-1'>{label}</label>
						{field.control === 'select' ? (
							<WebSelect
								className='w-full'
								aria-label={label}
								value={draft.actionVerb}
								onChange={(e) => setField(field.name, e.target.value)}
							>
								{HYPERLINK_ACTION_VERBS.map(({ verb, labelKey }) => (
									<option key={verb} value={verb}>
										{t(labelKey)}
									</option>
								))}
							</WebSelect>
						) : (
							<input
								ref={index === 0 ? inputRef : undefined}
								type={field.control}
								aria-label={label}
								className={inputCls}
								placeholder={field.placeholder}
								min={field.control === 'number' ? 1 : undefined}
								max={field.control === 'number' ? slideCount : undefined}
								value={hyperlinkEditFieldText(draft, field.name)}
								onChange={(e) => setField(field.name, e.target.value)}
								onKeyDown={handleEnterKey}
							/>
						)}
						{field.name === 'slideNumber' && (
							<p className='text-[10px] text-muted-foreground mt-1'>
								{t('pptx.hyperlink.slideRange', { max: slideCount })}
							</p>
						)}
					</div>
				);
			})}
		</div>
	);
}
