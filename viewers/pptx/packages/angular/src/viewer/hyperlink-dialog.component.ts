/**
 * hyperlink-dialog.component.ts: Set or clear an element's click hyperlink.
 *
 * Selector: `pptx-hyperlink-dialog`
 *
 * The targets (a web address, an email address, a slide of this deck, a file, or a show jump),
 * each tab's fields and the patch they make are the shared model in `ooxml-ui/pptx`
 * (`hyperlink-edit-target`), as in every binding. On apply it emits a `save` patch shaped as
 * `{ actionClick: PptxAction | undefined }`, and none when there is nothing to apply (the fields
 * are unchanged, or the address is one the URL guard blocks); "Remove link" emits the clearing
 * patch.
 *
 * Composes {@link ModalDialogComponent}.
 */

import {
	ChangeDetectionStrategy,
	Component,
	CUSTOM_ELEMENTS_SCHEMA,
	computed,
	effect,
	input,
	output,
	signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
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
import type { HyperlinkEditFieldName, HyperlinkTargetType } from 'ooxml-ui/pptx';
import type { PptxElement } from 'pptx-viewer-core';

import type { DialogFooterActionSpec } from './dialog-footer.component';
import { DialogFooterComponent } from './dialog-footer.component';
import { ModalDialogComponent } from './modal-dialog.component';

@Component({
	selector: 'pptx-hyperlink-dialog',
	standalone: true,
	changeDetection: ChangeDetectionStrategy.OnPush,
	schemas: [CUSTOM_ELEMENTS_SCHEMA],
	imports: [DialogFooterComponent, ModalDialogComponent, TranslatePipe],
	template: `
		<pptx-modal-dialog
			[open]="open()"
			[title]="'pptx.hyperlink.editTitle' | translate"
			(close)="onClose()"
		>
			<div class="pptx-ng-hyperlink-form">
				<div class="pptx-ng-hyperlink-tabs">
					@for (tab of targets; track tab.type) {
						<button
							type="button"
							class="pptx-ng-hyperlink-tab"
							[class.pptx-ng-hyperlink-tab-active]="draft().targetType === tab.type"
							[attr.aria-pressed]="draft().targetType === tab.type"
							(click)="selectTarget(tab.type)"
						>
							{{ tab.labelKey | translate }}
						</button>
					}
				</div>

				@for (field of fields(); track field.name) {
					<label class="pptx-ng-hyperlink-field">
						<span class="pptx-ng-hyperlink-label">{{ field.labelKey | translate }}</span>
						@if (field.control === 'select') {
							<pptx-ui-select
								class="pptx-ng-hyperlink-input"
								[attr.aria-label]="field.labelKey | translate"
								[value]="draft().actionVerb"
								(change)="setField(field.name, asValue($event))"
							>
								@for (opt of verbs; track opt.verb) {
									<option [value]="opt.verb" [selected]="opt.verb === draft().actionVerb">
										{{ opt.labelKey | translate }}
									</option>
								}
							</pptx-ui-select>
						} @else {
							<input
								class="pptx-ng-hyperlink-input"
								[type]="field.control"
								[attr.aria-label]="field.labelKey | translate"
								[attr.placeholder]="field.placeholder ?? null"
								[attr.min]="field.control === 'number' ? 1 : null"
								[attr.max]="field.control === 'number' ? slideCount() : null"
								[value]="fieldValue(field.name)"
								(input)="setField(field.name, asValue($event))"
								(keydown.enter)="onEnter($event)"
							/>
						}
						@if (field.name === 'slideNumber' && slideCount() > 0) {
							<span class="pptx-ng-hyperlink-hint">{{
								'pptx.hyperlink.slideRange' | translate: { max: slideCount() }
							}}</span>
						}
					</label>
				}
			</div>

			<div footer>
				<pptx-dialog-footer [actions]="footerActions()" (action)="onFooterAction($event)" />
			</div>
		</pptx-modal-dialog>
	`,
	styles: [
		`
			.pptx-ng-hyperlink-form {
				display: flex;
				flex-direction: column;
				gap: 12px;
				min-width: 280px;
			}

			.pptx-ng-hyperlink-tabs {
				display: flex;
				gap: 4px;
				border-bottom: 1px solid var(--pptx-border, #e5e7eb);
			}

			.pptx-ng-hyperlink-tab {
				padding: 6px 12px;
				font-size: 12px;
				color: var(--pptx-muted-foreground, #6b7280);
				background: none;
				border: none;
				border-bottom: 2px solid transparent;
				cursor: pointer;
			}

			.pptx-ng-hyperlink-tab-active {
				color: var(--pptx-primary, #2563eb);
				font-weight: 500;
				border-bottom-color: var(--pptx-primary, #2563eb);
			}

			.pptx-ng-hyperlink-field {
				display: flex;
				flex-direction: column;
				gap: 4px;
			}

			.pptx-ng-hyperlink-label {
				font-size: 12px;
				font-weight: 500;
				color: var(--pptx-muted-foreground, #6b7280);
			}

			.pptx-ng-hyperlink-hint {
				font-size: 10px;
				color: var(--pptx-muted-foreground, #6b7280);
			}

			.pptx-ng-hyperlink-input {
				width: 100%;
				padding: 6px 10px;
				font-size: 13px;
				color: var(--pptx-foreground, #111827);
				background: var(--pptx-background, #ffffff);
				border: 1px solid var(--pptx-border, #e5e7eb);
				border-radius: 4px;
				outline: none;
			}

			.pptx-ng-hyperlink-input:focus {
				border-color: var(--pptx-primary, #2563eb);
				box-shadow: 0 0 0 1px var(--pptx-primary, #2563eb);
			}
		`,
	],
})
export class HyperlinkDialogComponent {
	protected readonly targets = HYPERLINK_TARGET_TYPES;
	protected readonly verbs = HYPERLINK_ACTION_VERBS;

	/** Footer actions for the shared `pptx-ui-dialog-footer`. */
	protected readonly footerActions = computed<DialogFooterActionSpec[]>(() => [
		...(this.hasLink()
			? [
					{
						id: 'remove',
						labelKey: 'pptx.hyperlinkDialog.removeLink',
						variant: 'danger' as const,
						align: 'start' as const,
					},
				]
			: []),
		{ id: 'cancel', labelKey: 'pptx.hyperlinkDialog.cancel' },
		{ id: 'apply', labelKey: 'pptx.hyperlinkDialog.apply', variant: 'primary' as const },
	]);

	protected onFooterAction(id: string): void {
		if (id === 'remove') {
			this.clear();
		} else if (id === 'apply') {
			this.apply();
		} else {
			this.onClose();
		}
	}

	/** Whether the dialog is open. */
	readonly open = input<boolean>(false);

	/** The element whose hyperlink is being edited, or `null`. */
	readonly element = input<PptxElement | null>(null);

	/** The deck's slide count: the Slide field's bounds, and a slide jump stays inside the deck. */
	readonly slideCount = input<number>(0);

	/** Emitted when the user applies a change. Payload is a merge patch. */
	readonly save = output<Partial<PptxElement>>();

	/** Emitted when the dialog should close without saving. */
	readonly close = output<void>();

	/** The dialog's fields (the shared model's draft). */
	readonly draft = signal(seedHyperlinkEditDraft(undefined));

	protected readonly fields = computed(() => hyperlinkEditFields(this.draft().targetType));

	/** Whether the current element already links anywhere. */
	readonly hasLink = computed(() => hasHyperlinkEditTarget(this.element()));

	constructor() {
		// Re-seed the form from the element each time the dialog opens (or the
		// target element changes while open).
		effect(() => {
			if (this.open()) {
				this.draft.set(seedHyperlinkEditDraft(this.element()?.actionClick));
			}
		});
	}

	asValue(event: Event): string {
		return (event.target as HTMLInputElement).value;
	}

	fieldValue(name: HyperlinkEditFieldName): string {
		return String(this.draft()[name]);
	}

	selectTarget(targetType: HyperlinkTargetType): void {
		this.draft.update((draft) => ({ ...draft, targetType }));
	}

	setField(name: HyperlinkEditFieldName, value: string): void {
		this.draft.update((draft) => setHyperlinkEditField(draft, name, value));
	}

	onEnter(event: Event): void {
		event.preventDefault();
		this.apply();
	}

	onClose(): void {
		this.close.emit();
	}

	apply(): void {
		const element = this.element();
		const patch = element
			? buildHyperlinkEditPatch(element, this.draft(), this.slideCount())
			: undefined;
		if (patch) {
			this.save.emit(patch);
		}
		this.onClose();
	}

	clear(): void {
		this.save.emit(buildClearHyperlinkPatch());
		this.onClose();
	}
}
