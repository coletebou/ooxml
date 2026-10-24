import {
	HYPERLINK_TARGET_TYPES,
	hasHyperlinkEditTarget,
	seedHyperlinkEditDraft,
	setHyperlinkEditField,
} from 'ooxml-ui/pptx';
import type { HyperlinkEditDraft, HyperlinkEditFieldName } from 'ooxml-ui/pptx';
import type { PptxElement } from 'pptx-viewer-core';
import React, { useState, useEffect, useRef } from 'react';
import { LuX } from 'react-icons/lu';

import { useModalDismissDrag } from '../hooks';
import { useTranslation } from '../i18n/use-translation';
import { cn } from '../utils';
import { DialogFooter } from './DialogFooter';
import { HyperlinkTabContent } from './HyperlinkTabContent';

/**
 * Props for the {@link HyperlinkEditDialog} component.
 */
interface HyperlinkEditDialogProps {
	open: boolean;
	/** The element being linked: its click action fills the fields each time the dialog opens. */
	element?: PptxElement;
	slideCount: number;
	onConfirm: (draft: HyperlinkEditDraft) => void;
	/** Remove link, offered while the element links anywhere. */
	onRemove: () => void;
	onCancel: () => void;
}

/**
 * Tabbed modal dialog for creating or editing hyperlinks.
 *
 * Its targets, their fields and the patch they make are the shared model in `ooxml-ui/pptx`
 * (`hyperlink-edit-target`): a web address, an email address, a slide of this deck, a file, or a
 * show jump. The panel mounts only while the dialog is open, so the fields are seeded from the
 * element's click action each time it opens, and `onConfirm` gets the edited fields.
 *
 * @param props - {@link HyperlinkEditDialogProps}
 * @returns The dialog element, or `null` when `open` is `false`.
 */
export function HyperlinkEditDialog({
	open,
	...panel
}: HyperlinkEditDialogProps): React.ReactElement | null {
	return open ? <HyperlinkEditPanel {...panel} /> : null;
}

function HyperlinkEditPanel({
	element,
	slideCount,
	onConfirm,
	onRemove,
	onCancel,
}: Omit<HyperlinkEditDialogProps, 'open'>): React.ReactElement {
	const { t } = useTranslation();
	const { panelStyle, handlers: dragHandlers } = useModalDismissDrag(onCancel);
	const inputRef = useRef<HTMLInputElement>(null);
	const [draft, setDraft] = useState(() => seedHyperlinkEditDraft(element?.actionClick));

	useEffect(() => {
		const timer = setTimeout(() => inputRef.current?.focus(), 50);
		return () => clearTimeout(timer);
	}, []);

	const handleConfirm = () => onConfirm(draft);
	const setField = (name: HyperlinkEditFieldName, value: string) =>
		setDraft((current) => setHyperlinkEditField(current, name, value));

	const tabCls = (active: boolean) =>
		cn(
			'px-3 py-1.5 text-xs rounded-t border-b-2 transition-colors',
			active
				? 'border-primary text-primary font-medium'
				: 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
		);

	const inputCls =
		'w-full rounded border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary';

	return (
		<>
			<div style={{ zIndex: 1200 }} className='fixed inset-0 bg-black/40' onClick={onCancel} />
			<div
				style={{ zIndex: 1201 }}
				className='fixed inset-0 flex items-center justify-center pointer-events-none'
			>
				{/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- stopPropagation only, so a click inside the panel doesn't bubble to the backdrop's close handler */}
				<div
					role='dialog'
					aria-modal='true'
					aria-label={t('pptx.hyperlink.editTitle')}
					style={panelStyle}
					className='pointer-events-auto w-[440px] rounded-lg border border-border bg-popover shadow-2xl max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:w-full max-md:max-h-[88dvh] max-md:overflow-y-auto max-md:rounded-t-2xl max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0 max-md:pb-[max(env(safe-area-inset-bottom),0px)]'
					onClick={(e) => e.stopPropagation()}
				>
					{/* Header — also a swipe-down-to-dismiss grab region on touch. */}
					<div
						{...dragHandlers}
						className='flex items-center justify-between px-4 py-3 border-b border-border touch-none'
					>
						<h2 className='text-sm font-semibold text-foreground'>
							{t('pptx.hyperlink.editTitle')}
						</h2>
						<button
							type='button'
							aria-label={t('pptx.common.close')}
							className='text-muted-foreground hover:text-foreground'
							onClick={onCancel}
						>
							<LuX className='w-4 h-4' />
						</button>
					</div>

					{/* Tab bar: one button per target, the active one pressed. */}
					<div className='flex gap-1 px-4 pt-2 border-b border-border'>
						{HYPERLINK_TARGET_TYPES.map(({ type, labelKey }) => (
							<button
								key={type}
								type='button'
								aria-pressed={draft.targetType === type}
								className={tabCls(draft.targetType === type)}
								onClick={() => setDraft((current) => ({ ...current, targetType: type }))}
							>
								{t(labelKey)}
							</button>
						))}
					</div>

					{/* Body */}
					<HyperlinkTabContent
						draft={draft}
						setField={setField}
						slideCount={slideCount}
						inputRef={inputRef}
						inputCls={inputCls}
						onEnterConfirm={handleConfirm}
					/>

					{/* Footer */}
					<div className='flex justify-end gap-2 px-4 py-3 border-t border-border'>
						<DialogFooter
							actions={[
								...(hasHyperlinkEditTarget(element)
									? [
											{
												id: 'remove',
												label: t('pptx.hyperlinkDialog.removeLink'),
												variant: 'danger' as const,
												align: 'start' as const,
											},
										]
									: []),
								{ id: 'cancel', label: t('pptx.common.cancel') },
								{ id: 'apply', label: t('pptx.common.apply'), variant: 'primary' },
							]}
							onAction={(id) =>
								id === 'apply' ? handleConfirm() : id === 'remove' ? onRemove() : onCancel()
							}
						/>
					</div>
				</div>
			</div>
		</>
	);
}
