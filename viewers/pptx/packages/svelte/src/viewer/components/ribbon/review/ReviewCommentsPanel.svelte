<script lang="ts">
	/**
	 * ReviewCommentsPanel: the active slide's comments in the shared comments pane
	 * (`pptx-ui-comments-pane`), driven by the shared `createPptxCommentsPaneBinding` like every
	 * binding's. The Review popover, the inspector's Comments tab and the phone's Comments sheet
	 * all show this panel; every edit is one history entry through EditorState.
	 */
	import type { PptxComment, PptxModernCommentAuthor, PptxSlide } from 'pptx-viewer-core';
	import { createPptxCommentsPaneBinding } from 'ooxml-ui/pptx';
	import type { PptxCommentsPaneBinding, PptxCommentsPaneElement } from 'ooxml-ui/pptx';

	import { useTranslator } from '../../../../i18n/context';
	import { useViewerOptions } from '../../../state/viewer-options-context';
	import type { EditorState } from '../../../editor/editor-state.svelte';

	const {
		editor,
		embedded = false,
	}: {
		editor: EditorState;
		/**
		 * True when hosted inside a chrome that already renders its own title +
		 * close button (the mobile `MobileSheet`). Suppresses the pane's heading
		 * so mobile doesn't show "Comments" twice stacked.
		 */
		embedded?: boolean;
	} = $props();
	const t = useTranslator();
	const optionsState = useViewerOptions();
	/** Host `authorName`, then Options > General > "User name", then the generic default label. */
	const authorName = $derived(
		editor.hostAuthorName ||
			optionsState.options.general.userName ||
			t('pptx.comments.defaultAuthorName'),
	);
	const slide = $derived(editor.slides[editor.currentSlideIndex]);
	/**
	 * The people an `@` offers: modern authors plus legacy (`ppt/commentAuthors.xml`) ones
	 * mapped into the same shape (their `id` doubles as `userId`; `providerId` is a fixed
	 * marker, unused by matching).
	 */
	const mentionAuthors = $derived<PptxModernCommentAuthor[]>([
		...editor.modernCommentAuthors,
		...editor.commentAuthors.map((author) => ({
			id: author.id,
			name: author.name,
			initials: author.initials,
			userId: author.id,
			providerId: 'legacy',
		})),
	]);

	function replaceComments(next: PptxComment[]): void {
		const index = editor.currentSlideIndex;
		const slides = editor.slides.map((item, itemIndex) =>
			itemIndex === index ? { ...item, comments: next } : item,
		) as PptxSlide[];
		editor.commitSlides(slides);
	}

	let pane = $state<PptxCommentsPaneElement>();
	let binding = $state.raw<PptxCommentsPaneBinding | null>(null);
	$effect(() => {
		if (!pane) {
			return;
		}
		const next = createPptxCommentsPaneBinding(pane, {
			applyComments: replaceComments,
			// A picked thread selects the element it is on, when that is still on the slide.
			selectThread: (_commentId, elementId) => {
				if (elementId && slide?.elements.some(({ id }) => id === elementId)) {
					editor.select(elementId);
				}
			},
			drafts: editor.commentDrafts,
		});
		binding = next;
		return () => {
			next.dispose();
			binding = null;
		};
	});
	$effect(() => {
		binding?.sync({
			comments: slide?.comments ?? [],
			editable: editor.editable,
			authorName,
			authors: mentionAuthors,
			elements: slide?.elements ?? [],
			selectedElementId: editor.selectedElementId,
			t,
			showHeading: !embedded,
			draftKey: slide?.id ?? null,
		});
	});
</script>

<pptx-ui-comments-pane class="pptx-svelte-comments" bind:this={pane}></pptx-ui-comments-pane>

<style>
	.pptx-svelte-comments { display: block; width: min(340px, 100%); }

	/*
	 * Touch target: matches MIN_TOUCH_TARGET_PX (44) from pptx-viewer-shared's render/responsive
	 * module. The pane draws its buttons in its shadow root; its sizing token reaches them (an
	 * outer rule wins over the pane's own :host value).
	 */
	@media (max-width: 767px) {
		.pptx-svelte-comments { --office-input-height: 44px; }
	}
</style>
