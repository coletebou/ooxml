import type { PptxCommentDrafts } from 'ooxml-ui/pptx';

import type { Translator } from '../../i18n';
import { createEl } from '../../render';
import { createCommentsPane } from '../comments-pane';
import type { InspectorDeckState, InspectorHandlers } from './types';

export interface CommentsTab {
	el: HTMLElement;
	update(state: InspectorDeckState): void;
}

type CommentsHandlers = Pick<InspectorHandlers, 'applyComments' | 'selectElement'>;

/**
 * The inspector's Comments tab: the active slide's threads in the shared comments pane
 * (`pptx-ui-comments-pane`), the same pane as the workspace Comments pane, without its own
 * heading since the tab names it. Picking a thread selects the element it is on.
 */
export function createCommentsTab(
	doc: Document,
	t: Translator,
	handlers: CommentsHandlers,
	/** The viewer's store of unposted comments (one for every comments pane). */
	drafts?: PptxCommentDrafts,
): CommentsTab {
	const el = createEl(doc, 'div', 'pptxv-inspector-comments');
	let elementIds = new Set<string>();
	const pane = createCommentsPane(
		doc,
		t,
		{
			applyComments: (next) => handlers.applyComments(next),
			selectThread: (_commentId, elementId) => {
				if (elementId && elementIds.has(elementId)) {
					handlers.selectElement(elementId);
				}
			},
			...(drafts ? { drafts } : {}),
		},
		{ showHeading: false },
	);
	el.appendChild(pane.el);

	return {
		el,
		update(state) {
			elementIds = new Set((state.commentsView.elements ?? []).map(({ id }) => id));
			pane.update(state.commentsView);
		},
	};
}
