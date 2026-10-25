import type {
	PptxCommentsPaneElement,
	PptxCommentsPaneHost,
	PptxCommentsPaneInput,
} from 'ooxml-ui/pptx';
import { createPptxCommentsPaneBinding, registerPptxWebControls } from 'ooxml-ui/pptx';
import type { PptxCommentAuthor, PptxModernCommentAuthor } from 'pptx-viewer-core';

import type { Translator } from '../i18n';

/** What a comments surface shows: the shared pane's input, less the strings and the chrome. */
export type CommentsPaneView = Omit<PptxCommentsPaneInput, 't' | 'closable' | 'showHeading'>;

export interface CommentsPane {
	el: PptxCommentsPaneElement;
	/** Show `view`; a view equal to the last one (field by field) changes nothing. */
	update(view: CommentsPaneView): void;
	/** Stop listening to the pane (the element stays with the caller). */
	destroy(): void;
}

function sameView(a: CommentsPaneView, b: CommentsPaneView): boolean {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof CommentsPaneView>;
	return [...keys].every((key) => a[key] === b[key]);
}

/**
 * One `pptx-ui-comments-pane` (the shared Office comments pane), driven by the shared
 * `createPptxCommentsPaneBinding`. Every vanilla comments surface (the workspace pane, the
 * inspector's Comments tab and the phone's Comments sheet) is one of these.
 */
export function createCommentsPane(
	doc: Document,
	t: Translator,
	host: PptxCommentsPaneHost,
	options: { closable?: boolean; showHeading?: boolean } = {},
): CommentsPane {
	registerPptxWebControls();
	const el = doc.createElement('pptx-ui-comments-pane') as PptxCommentsPaneElement;
	const binding = createPptxCommentsPaneBinding(el, host);
	let shown: CommentsPaneView | null = null;
	return {
		el,
		update(view) {
			if (shown && sameView(shown, view)) {
				return;
			}
			shown = view;
			binding.sync({
				...view,
				t,
				closable: options.closable ?? false,
				showHeading: options.showHeading ?? true,
			});
		},
		destroy() {
			binding.dispose();
		},
	};
}

/**
 * The people an `@` offers: the deck's modern authors (`ppt/authors.xml`) plus its legacy ones
 * (`ppt/commentAuthors.xml`) mapped into the modern shape, a legacy id already taken by a modern
 * author skipped. The last result is kept while both inputs are the same arrays, so a pane fed
 * from the store sees the same list and does not redraw on unrelated changes.
 */
let lastAuthors: {
	modern: readonly PptxModernCommentAuthor[];
	legacy: readonly PptxCommentAuthor[];
	combined: PptxModernCommentAuthor[];
} | null = null;

export function combineCommentMentionAuthors(
	modern: readonly PptxModernCommentAuthor[],
	legacy: readonly PptxCommentAuthor[],
): PptxModernCommentAuthor[] {
	if (lastAuthors?.modern === modern && lastAuthors.legacy === legacy) {
		return lastAuthors.combined;
	}
	const seen = new Set(modern.map((author) => author.id));
	const mapped = legacy
		.filter((author) => !seen.has(author.id))
		.map((author) => ({ id: author.id, name: author.name, userId: '', providerId: '' }));
	const combined = [...modern, ...mapped];
	lastAuthors = { modern, legacy, combined };
	return combined;
}

/** Where the workspace pane draws its rows: the review commands reveal comments there. */
export function commentsPanelRoot(scope: ParentNode): ShadowRoot | null {
	return scope.querySelector<HTMLElement>('[data-pptx-comments-panel]')?.shadowRoot ?? null;
}

/** Live view of the comments the workspace pane shows. */
export interface CommentsPanelModel {
	read(): CommentsPaneView;
	/** Notify on any state change; returns an unsubscribe function. */
	subscribe(listener: () => void): () => void;
}

/** Detach hook stored on the pane so a replacement can end its subscription. */
const DISPOSE = Symbol('pptxv-comments-panel-dispose');

interface DisposablePane extends HTMLElement {
	[DISPOSE]?: () => void;
}

/**
 * Open the workspace Comments pane over the stage (Review > Show Comments, a comment marker).
 * LIVE: it follows `model` until closed, so an add, resolve or edit redraws in place with the
 * pane still open. Opening it again replaces the open one.
 */
export function openCommentsPanel(
	doc: Document,
	root: HTMLElement,
	t: Translator,
	model: CommentsPanelModel,
	host: Omit<PptxCommentsPaneHost, 'close'>,
): HTMLElement {
	const existing = root.querySelector<DisposablePane>('[data-pptx-comments-panel]');
	existing?.[DISPOSE]?.();
	existing?.remove();

	const pane = createCommentsPane(
		doc,
		t,
		{
			...host,
			close: () => {
				dispose();
				el.remove();
			},
		},
		{ closable: true },
	);
	const el: DisposablePane = pane.el;
	el.classList.add('pptxv-workspace-pane');
	el.dataset.pptxCommentsPanel = 'true';
	const dispose = (): void => {
		unsubscribe();
		pane.destroy();
		delete el[DISPOSE];
	};
	const unsubscribe = model.subscribe(() => {
		if (!el.isConnected) {
			dispose();
			return;
		}
		pane.update(model.read());
	});
	el[DISPOSE] = dispose;
	pane.update(model.read());
	root.appendChild(el);
	return el;
}
