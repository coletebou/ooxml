import { createPptxCommentsPaneBinding } from 'ooxml-ui/pptx';
import type {
	PptxCommentDrafts,
	PptxCommentsPaneBinding,
	PptxCommentsPaneElement,
} from 'ooxml-ui/pptx';
import type { PptxComment, PptxElement, PptxModernCommentAuthor } from 'pptx-viewer-core';
import React, { useLayoutEffect, useRef } from 'react';

import { useTranslation } from '../../i18n/use-translation';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface InspectorCommentsSectionProps {
	/** The active slide's comments. */
	comments: PptxComment[];
	canEdit: boolean;
	/** Who writes new comments, and whose comments offer Edit. */
	authorName: string;
	/** Modern comment authors: the people an `@` offers. */
	commentAuthors: PptxModernCommentAuthor[];
	/** The active slide's elements, for each thread's anchor. */
	elements: readonly PptxElement[];
	/** A new comment goes on this element (the selection). */
	selectedElementId: string | null;
	/** The viewer's store of unposted comments, so a draft outlives this tab (`useComments`). */
	drafts?: PptxCommentDrafts;
	/** The slide the drafts belong to (its id). */
	draftKey?: string | null;
	/** The slide's whole new comment list, which the host commits as one history entry. */
	onCommentsChange: (next: PptxComment[]) => void;
	onSelectElement: (id: string | null) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * The active slide's comments in the shared comments pane (`pptx-ui-comments-pane`), driven by
 * the shared `createPptxCommentsPaneBinding` like every binding's. Every change comes out as the
 * slide's whole new comment list; a picked thread selects the element it is on.
 */
export function InspectorCommentsSection(props: InspectorCommentsSectionProps): React.ReactElement {
	const { comments, canEdit, authorName, commentAuthors, elements, selectedElementId, draftKey } =
		props;
	const { t, locale } = useTranslation();
	const ref = useRef<PptxCommentsPaneElement>(null);
	const binding = useRef<PptxCommentsPaneBinding | null>(null);
	// The binding lives as long as the element; its callbacks read the latest props.
	const latest = useRef(props);
	latest.current = props;

	useLayoutEffect(() => {
		const created = createPptxCommentsPaneBinding(ref.current!, {
			applyComments: (next) => latest.current.onCommentsChange(next),
			// A picked thread selects the element it is on, when that is still on the slide.
			selectThread: (_commentId, elementId) => {
				if (elementId && latest.current.elements.some(({ id }) => id === elementId)) {
					latest.current.onSelectElement(elementId);
				}
			},
			...(latest.current.drafts ? { drafts: latest.current.drafts } : {}),
		});
		binding.current = created;
		return () => {
			created.dispose();
			binding.current = null;
		};
	}, []);

	useLayoutEffect(() => {
		binding.current?.sync({
			comments,
			editable: canEdit,
			authorName,
			authors: commentAuthors,
			elements,
			selectedElementId,
			t: (key) => t(key),
			// The inspector's Comments tab is titled already.
			showHeading: false,
			locale,
			draftKey: draftKey ?? null,
		});
	}, [
		comments,
		canEdit,
		authorName,
		commentAuthors,
		elements,
		selectedElementId,
		t,
		locale,
		draftKey,
	]);

	// Touch target: MIN_TOUCH_TARGET_PX (44) from render/responsive. The pane draws its buttons in
	// its shadow root; its sizing token reaches them (an outer rule beats the pane's own :host).
	return (
		<pptx-ui-comments-pane
			ref={ref}
			className='pptx-comments-panel block w-full max-md:[--office-input-height:44px]'
		/>
	);
}
