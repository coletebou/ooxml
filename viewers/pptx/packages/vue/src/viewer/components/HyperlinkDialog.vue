<script setup lang="ts">
import {
	HYPERLINK_ACTION_VERBS,
	HYPERLINK_TARGET_TYPES,
	buildClearHyperlinkPatch,
	buildHyperlinkEditPatch,
	hasHyperlinkEditTarget,
	hyperlinkEditFieldText,
	hyperlinkEditFields,
	seedHyperlinkEditDraft,
	setHyperlinkEditField,
} from 'ooxml-ui/pptx';
import type { HyperlinkEditFieldName, HyperlinkTargetType } from 'ooxml-ui/pptx';
import type { PptxElement } from 'pptx-viewer-core';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import DialogFooter from './DialogFooter.vue';
import ModalDialog from './ModalDialog.vue';

/**
 * HyperlinkDialog: set, change, or clear an element's click action.
 *
 * The targets (a web address, an email address, a slide of this deck, a file, or a show jump),
 * each tab's fields and the patch they make are the shared model in `ooxml-ui/pptx`
 * (`hyperlink-edit-target`), as in every binding. A tooltip applies to any target.
 *
 * Emits a `save` patch shaped as `{ actionClick: PptxAction | undefined }` (undefined clears the
 * action), and none when there is nothing to apply (the fields are unchanged, or the address is
 * one the URL guard blocks); apply it with `ops.updateElement(id, patch)`.
 */
const props = defineProps<{
	/** Whether the dialog is open. */
	open: boolean;
	/** The element whose action is being edited, or `null`. */
	element: PptxElement | null;
	/** Total slide count, for the "go to slide" number field bounds. */
	slideCount?: number;
}>();

const emit = defineEmits<{
	(e: 'save', patch: Partial<PptxElement>): void;
	(e: 'close'): void;
}>();

const { t } = useI18n();

const draft = ref(seedHyperlinkEditDraft(undefined));
const fields = computed(() => hyperlinkEditFields(draft.value.targetType));
const hasExistingLink = computed(() => hasHyperlinkEditTarget(props.element));

// Seed the form from the element's current click action each time the dialog
// opens (or the target element changes while open).
watch(
	[() => props.open, () => props.element],
	([isOpen]) => {
		if (isOpen) {
			draft.value = seedHyperlinkEditDraft(props.element?.actionClick);
		}
	},
	{ immediate: true },
);

function selectTarget(targetType: HyperlinkTargetType): void {
	draft.value = { ...draft.value, targetType };
}

function setField(name: HyperlinkEditFieldName, value: string): void {
	draft.value = setHyperlinkEditField(draft.value, name, value);
}

function close(): void {
	emit('close');
}

function save(): void {
	const patch = props.element
		? buildHyperlinkEditPatch(props.element, draft.value, props.slideCount)
		: undefined;
	if (patch) {
		emit('save', patch);
	}
	close();
}

function clear(): void {
	emit('save', buildClearHyperlinkPatch());
	close();
}

const tabCls = (active: boolean) =>
	[
		'px-3 py-1.5 text-xs rounded-t border-b-2 transition-colors',
		active
			? 'border-primary text-primary font-medium'
			: 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
	].join(' ');

const inputCls =
	'w-full rounded border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary';
</script>

<template>
	<ModalDialog :open="open" :title="t('pptx.hyperlink.editTitle')" @close="close">
		<div class="pptx-vue-hyperlink-form flex min-w-[280px] flex-col gap-3">
			<div class="flex gap-1 border-b border-border">
				<button
					v-for="tab in HYPERLINK_TARGET_TYPES"
					:key="tab.type"
					type="button"
					:aria-pressed="draft.targetType === tab.type"
					:class="tabCls(draft.targetType === tab.type)"
					@click="selectTarget(tab.type)"
				>
					{{ t(tab.labelKey) }}
				</button>
			</div>

			<label v-for="field in fields" :key="field.name" class="flex flex-col gap-1">
				<span class="text-xs font-medium text-muted-foreground">{{ t(field.labelKey) }}</span>
				<pptx-ui-select
					v-if="field.control === 'select'"
					:aria-label="t(field.labelKey)"
					:value="draft.actionVerb"
					:class="inputCls"
					@change="setField(field.name, ($event.target as HTMLSelectElement).value)"
				>
					<option v-for="opt in HYPERLINK_ACTION_VERBS" :key="opt.verb" :value="opt.verb">
						{{ t(opt.labelKey) }}
					</option>
				</pptx-ui-select>
				<input
					v-else
					:type="field.control"
					:aria-label="t(field.labelKey)"
					:value="hyperlinkEditFieldText(draft, field.name)"
					:min="field.control === 'number' ? 1 : undefined"
					:max="field.control === 'number' ? props.slideCount : undefined"
					:placeholder="field.placeholder"
					:class="inputCls"
					@input="setField(field.name, ($event.target as HTMLInputElement).value)"
					@keydown.enter.prevent="save"
				/>
				<span
					v-if="field.name === 'slideNumber' && props.slideCount"
					class="text-[10px] text-muted-foreground"
				>
					{{ t('pptx.hyperlink.slideRange', { max: props.slideCount }) }}
				</span>
			</label>
		</div>

		<template #footer>
			<DialogFooter
				:actions="[
					...(hasExistingLink
						? [
								{
									id: 'remove',
									label: t('pptx.hyperlinkDialog.removeLink'),
									variant: 'danger' as const,
									align: 'start' as const,
								},
							]
						: []),
					{ id: 'cancel', label: t('pptx.comments.cancel') },
					{ id: 'apply', label: t('pptx.hyperlinkDialog.apply'), variant: 'primary' },
				]"
				@action="(id) => (id === 'remove' ? clear() : id === 'apply' ? save() : close())"
			/>
		</template>
	</ModalDialog>
</template>
