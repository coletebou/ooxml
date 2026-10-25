<script setup lang="ts">
import { createPptxCommentsPaneBinding, registerPptxWebControls } from 'ooxml-ui/pptx';
import type {
	PptxCommentDrafts,
	PptxCommentsPaneBinding,
	PptxCommentsPaneElement,
} from 'ooxml-ui/pptx';
import type { PptxComment, PptxElement, PptxModernCommentAuthor } from 'pptx-viewer-core';
import { onBeforeUnmount, onMounted, ref, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
/**
 * CommentsPanel: the active slide's comments in the shared comments pane
 * (`pptx-ui-comments-pane`), driven by the shared `createPptxCommentsPaneBinding` like every
 * binding's. Every change comes out of `change` as the slide's whole new comment list, which
 * the host commits as one history entry; `select` reports a picked thread.
 */
const props = withDefaults(
	defineProps<{
		comments: PptxComment[];
		authorName: string;
		/**
		 * True when hosted inside a chrome that already renders its own title +
		 * close button (the mobile `MobileSheet`). Suppresses the pane's heading
		 * so mobile doesn't show "Comments" twice stacked.
		 */
		embedded?: boolean;
		/** Modern comment authors (`ppt/authors.xml`): the people an `@` offers. */
		modernCommentAuthors?: PptxModernCommentAuthor[];
		/** The active slide's elements, for each thread's anchor. */
		elements?: readonly PptxElement[];
		/** A new comment goes on this element (the selection). */
		selectedElementId?: string | null;
		/** False shows the controls disabled. */
		editable?: boolean;
		/** The viewer's store of unposted comments, so a draft outlives this panel. */
		drafts?: PptxCommentDrafts;
		/** The slide the drafts belong to (its id). */
		draftKey?: string | null;
	}>(),
	// An absent boolean prop is `false` in Vue, so the editable default has to be spelled out.
	{ editable: true, embedded: false },
);
const emit = defineEmits<{
	change: [next: PptxComment[]];
	select: [payload: { commentId: string; elementId?: string }];
}>();
const { t, locale } = useI18n();
registerPptxWebControls();
const pane = ref<PptxCommentsPaneElement>();
let binding: PptxCommentsPaneBinding | null = null;

function sync(): void {
	// Read everything first, so the effect tracks it before the pane is mounted.
	const input = {
		comments: props.comments,
		editable: props.editable,
		authorName: props.authorName,
		authors: props.modernCommentAuthors ?? [],
		elements: props.elements ?? [],
		selectedElementId: props.selectedElementId ?? null,
		t: (key: string) => t(key),
		showHeading: !props.embedded,
		locale: locale.value,
		draftKey: props.draftKey ?? null,
	};
	binding?.sync(input);
}

onMounted(() => {
	binding = createPptxCommentsPaneBinding(pane.value!, {
		applyComments: (next) => emit('change', next),
		// A picked thread reports the element it is on only while that is still on the slide.
		selectThread: (commentId, elementId) => {
			const onSlide = elementId && (props.elements ?? []).some(({ id }) => id === elementId);
			emit('select', { commentId, ...(onSlide ? { elementId } : {}) });
		},
		...(props.drafts ? { drafts: props.drafts } : {}),
	});
	sync();
});
watchEffect(sync);
onBeforeUnmount(() => {
	binding?.dispose();
	binding = null;
});
</script>

<template>
	<pptx-ui-comments-pane ref="pane" class="pptx-comments-panel block h-full min-h-0 w-full" />
</template>

<style scoped>
/*
 * Touch target: MIN_TOUCH_TARGET_PX (44) from render/responsive. The pane draws its buttons in
 * its shadow root; its sizing token reaches them (an outer rule beats the pane's own :host).
 */
@media (max-width: 767px) {
	.pptx-comments-panel {
		--office-input-height: 44px;
	}
}
</style>
