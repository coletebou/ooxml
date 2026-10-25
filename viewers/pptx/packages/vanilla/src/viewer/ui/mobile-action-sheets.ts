import type {
	MobileBarId,
	MobileBarRequestEvent,
	MobileInsertRequestEvent,
	MobileBarViewState,
	MobileSheetKey,
	PptxCommentDrafts,
	PptxUiMobileInsertElement,
	PptxUiRibbonInsertElement,
	ToolbarActionId,
} from 'ooxml-ui/pptx';
import {
	createSheetDismissGesture,
	isActionHidden,
	registerPptxWebControls,
	slideTitle,
	toggleSheet,
} from 'ooxml-ui/pptx';
import type { PptxComment, PptxSlide } from 'pptx-viewer-core';

import type { Translator } from '../i18n';
import { disposePptxRenderStage } from '../render';
import { createEl } from '../render';
import { createCommentsPane } from './comments-pane';
import type { CommentsPaneView } from './comments-pane';
import type { RibbonHandlers } from './ribbon/ribbon-types';

/** Paint one slide at `scale`, the same callback the desktop rail is given. */
export type MobileThumbnailRenderer = (slide: PptxSlide, scale: number) => HTMLElement;

export interface MobileActionSheets {
	el: HTMLElement;
	update(current: number, slides: readonly PptxSlide[], comments: readonly PptxComment[]): void;
	/** What the Comments sheet's pane shows; kept while the sheet is closed. */
	updateComments(view: CommentsPaneView): void;
	/**
	 * Hand the Slides sheet the deck renderer, so it can show the slides
	 * themselves rather than a list of their titles (which is all it had, and
	 * nothing like React's thumbnail list).
	 */
	setThumbnailRenderer(
		render: MobileThumbnailRenderer | null,
		canvasWidth: number,
		canvasHeight: number,
	): void;
	toggle(key: Exclude<MobileSheetKey, null>): void;
	close(): void;
	setEditable(editable: boolean): void;
	setNotesExpanded(expanded: boolean): void;
}

/** Thumbnail width in the sheet; the rail uses 128px in a narrower column. */
const MOBILE_THUMB_WIDTH = 148;

export function createMobileActionSheets(
	doc: Document,
	t: Translator,
	handlers: RibbonHandlers,
	onSelectSlide: (index: number) => void,
	inspector: HTMLElement | null,
	hiddenActions?: readonly ToolbarActionId[],
	/**
	 * The ribbon's shared Insert element. The phone Insert sheet reads its state and hands every
	 * request back to it, so Insert behaves exactly as on the ribbon (dialogs, undo, selection).
	 */
	insertSource?: () => PptxUiRibbonInsertElement | null,
	/**
	 * The Comments sheet's pane: picking a thread selects its element through `selectElement`,
	 * and unposted comments wait in the viewer's `drafts` store (one for every comments pane).
	 */
	commentsHost: { selectElement?(id: string): void; drafts?: PptxCommentDrafts } = {},
): MobileActionSheets {
	registerPptxWebControls();
	const el = createEl(doc, 'div', 'pptxv-mobile-actions');
	const sheetHost = createEl(doc, 'div', 'pptxv-mobile-sheet-host');
	sheetHost.setAttribute('role', 'dialog');
	sheetHost.setAttribute('aria-modal', 'true');
	const backdrop = doc.createElement('button');
	backdrop.type = 'button';
	backdrop.className = 'pptxv-mobile-sheet-backdrop';
	backdrop.setAttribute('aria-label', t('pptx.settings.close'));
	const sheet = createEl(doc, 'section', 'pptxv-mobile-sheet');
	const header = createEl(doc, 'header', 'pptxv-mobile-sheet-header');
	const handle = createEl(doc, 'span', 'pptxv-mobile-sheet-handle');
	const title = doc.createElement('strong');
	header.append(handle, title);
	const body = createEl(doc, 'div', 'pptxv-mobile-sheet-body');
	sheet.append(header, body);
	sheetHost.append(backdrop, sheet);
	sheetHost.hidden = true;
	el.appendChild(sheetHost);

	const insertSheet: PptxUiMobileInsertElement = doc.createElement('pptx-ui-mobile-insert');
	insertSheet.addEventListener('insert-request', (event) => {
		insertSource?.()?.dispatchEvent(
			new CustomEvent('insert-request', {
				detail: (event as MobileInsertRequestEvent).detail,
				bubbles: true,
				composed: true,
			}),
		);
		close();
	});
	let active: MobileSheetKey = null;
	let current = 0;
	let slides: readonly PptxSlide[] = [];
	let comments: readonly PptxComment[] = [];
	let editable = true;
	let notesExpanded = false;
	let renderThumbnail: MobileThumbnailRenderer | null = null;
	let canvasWidth = 960;
	let canvasHeight = 540;
	// One pane for the Comments sheet, kept across openings and updates so a draft survives them.
	let commentElementIds = new Set<string>();
	const commentsPane = createCommentsPane(
		doc,
		t,
		{
			applyComments: (next) =>
				handlers.edit.comments.applyChanges([{ slideIndex: current, comments: next }]),
			// A picked thread selects the element it is on, when that is still on the slide.
			selectThread: (_commentId, elementId) => {
				if (elementId && commentElementIds.has(elementId)) {
					commentsHost.selectElement?.(elementId);
				}
			},
			...(commentsHost.drafts ? { drafts: commentsHost.drafts } : {}),
		},
		{ showHeading: false },
	);
	const inspectorHome = inspector ? doc.createComment('inspector-home') : null;
	inspector?.parentNode?.insertBefore(inspectorHome!, inspector);

	const restoreInspector = () => {
		if (inspector && inspectorHome?.parentNode) {
			inspectorHome.parentNode.insertBefore(inspector, inspectorHome.nextSibling);
		}
	};
	const close = () => {
		active = null;
		disposePptxRenderStage(body);
		sheetHost.hidden = true;
		sheet.style.transform = '';
		restoreInspector();
		syncBar();
	};
	backdrop.addEventListener('click', close);
	const gesture = createSheetDismissGesture((offset, dragging) => {
		sheet.style.transform = offset > 0 ? `translateY(${offset}px)` : '';
		sheet.style.transition = dragging ? 'none' : '';
	}, close);
	const pointer = (event: PointerEvent) => ({
		clientY: event.clientY,
		pointerId: event.pointerId,
		currentTarget: header,
	});
	header.addEventListener('pointerdown', (event) => gesture.pointerDown(pointer(event)));
	header.addEventListener('pointermove', (event) => gesture.pointerMove(pointer(event)));
	header.addEventListener('pointerup', (event) => gesture.pointerUp(pointer(event)));
	header.addEventListener('pointercancel', (event) => gesture.cancel(pointer(event)));

	const render = (key: Exclude<MobileSheetKey, null>) => {
		disposePptxRenderStage(body);
		body.replaceChildren();
		title.textContent =
			key === 'inspector'
				? t('pptx.field.format')
				: t(
						`pptx.${key === 'slides' ? 'sections.slides' : key === 'comments' ? 'toolbar.comments' : key === 'insert' ? 'mobileBar.insert' : 'mobileToolbar.menu'}`,
					);
		sheetHost.setAttribute('aria-label', title.textContent);
		if (key === 'slides') {
			const list = createEl(doc, 'div', 'pptxv-mobile-slide-list');
			const scale = MOBILE_THUMB_WIDTH / Math.max(canvasWidth, 1);
			for (let index = 0; index < slides.length; index += 1) {
				const button = doc.createElement('button');
				button.type = 'button';
				const label = slideTitle(slides[index], index);
				button.setAttribute('aria-label', label);
				button.classList.toggle('is-active', index === current);
				if (index === current) {
					button.setAttribute('aria-current', 'true');
				}
				const number = createEl(doc, 'span', 'pptxv-mobile-slide-num');
				number.textContent = String(index + 1);
				button.appendChild(number);
				if (renderThumbnail) {
					const frame = createEl(doc, 'span', 'pptxv-mobile-slide-frame', {
						width: `${MOBILE_THUMB_WIDTH}px`,
						height: `${Math.round(canvasHeight * scale)}px`,
					});
					frame.dataset.pptxChrome = 'slide-frame';
					frame.appendChild(renderThumbnail(slides[index], scale));
					button.appendChild(frame);
				} else {
					// No renderer wired up (a host that never rendered a deck): the
					// title still names the slide.
					const caption = createEl(doc, 'span', 'pptxv-mobile-slide-title');
					caption.textContent = label;
					button.appendChild(caption);
				}
				button.addEventListener('click', () => {
					onSelectSlide(index);
					close();
				});
				list.appendChild(button);
			}
			body.appendChild(list);
		} else if (key === 'insert') {
			const source = insertSource?.();
			if (source) {
				insertSheet.state = source.state;
			}
			body.appendChild(insertSheet);
		} else if (key === 'inspector' && inspector) {
			body.appendChild(inspector);
		} else if (key === 'comments') {
			body.appendChild(commentsPane.el);
		} else {
			const buttons: readonly [string, () => void, ToolbarActionId | null][] = [
				[t('pptx.ribbon.insert'), () => handlers.insert.insert('text'), null],
				[t('pptx.presenter.previousSlide'), handlers.nav.prev, 'navigation'],
				[t('pptx.presenter.nextSlide'), handlers.nav.next, 'navigation'],
				[t('pptx.statusBar.zoomOut'), handlers.nav.zoomOut, 'zoom'],
				[t('pptx.statusBar.zoomIn'), handlers.nav.zoomIn, 'zoom'],
				[t('pptx.notes.title'), handlers.nav.toggleNotes, 'notes'],
				[t('pptx.statusBar.slideShow'), handlers.nav.togglePresentation, 'fullscreen'],
			];
			for (const [label, run, actionId] of buttons) {
				if (actionId && isActionHidden(actionId, hiddenActions)) {
					continue;
				}
				const button = doc.createElement('button');
				button.type = 'button';
				button.textContent = label;
				button.addEventListener('click', run);
				body.appendChild(button);
			}
		}
	};

	// A thin adapter over the shared `pptx-ui-mobile-bar`, which owns the markup,
	// the no-slides gating, the pressed state and the comment badge.
	const bar = doc.createElement('pptx-ui-mobile-bar');
	const openSheet = (key: Exclude<MobileSheetKey, null>): void => {
		active = toggleSheet(active, key);
		if (!active) {
			close();
			return;
		}
		if (active === 'insert') {
			insertSheet.reset();
		}
		render(active);
		sheetHost.hidden = false;
		syncBar();
	};
	bar.addEventListener('mobile-bar-request', (event) => {
		const key = (event as MobileBarRequestEvent).detail.id;
		if (key === 'notes') {
			handlers.nav.toggleNotes();
		} else {
			openSheet(key);
		}
	});
	el.appendChild(bar);
	const syncBar = (): void => {
		const editOnly: MobileBarId[] = ['insert', 'inspector', 'comments'];
		const state: MobileBarViewState = {
			slideCount: slides.length,
			activeSheet: active && active !== 'menu' ? active : notesExpanded ? 'notes' : null,
			commentCount: comments.length,
			hidden: isActionHidden('notes', hiddenActions) ? ['notes'] : [],
			disabled: [
				...(editable ? [] : editOnly),
				...(inspector ? [] : (['inspector'] as const)),
				...(insertSource?.() ? [] : (['insert'] as const)),
			],
			translate: t,
		};
		bar.state = state;
	};
	syncBar();
	return {
		el,
		update(nextCurrent, nextSlides, nextComments) {
			current = nextCurrent;
			slides = nextSlides;
			comments = nextComments;
			// The Comments sheet's pane follows `updateComments` in place.
			if (active && active !== 'comments') {
				render(active);
			}
			syncBar();
		},
		updateComments(view) {
			commentElementIds = new Set((view.elements ?? []).map(({ id }) => id));
			commentsPane.update(view);
		},
		setThumbnailRenderer(renderer, width, height) {
			renderThumbnail = renderer;
			canvasWidth = width;
			canvasHeight = height;
			if (active === 'slides') {
				render(active);
			}
		},
		toggle: openSheet,
		close,
		setEditable(nextEditable) {
			editable = nextEditable;
			if (!editable && active && ['insert', 'inspector', 'comments'].includes(active)) {
				close();
			}
			syncBar();
		},
		setNotesExpanded(expanded) {
			notesExpanded = expanded;
			syncBar();
		},
	};
}
