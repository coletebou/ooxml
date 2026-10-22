// The rich-text editor of <mail-compose>: what it starts with (the draft's HTML, else its text as
// lines; the HTML a quoted message or a reopened draft holds, `draftHtml`) and what arrives in it
// from elsewhere. A quoted message, a paste and a drop of HTML (from another page or from this one)
// all go through the message sanitiser first, so remote images are dropped and composing never
// loads a tracker, while a `cid:` picture of the draft's own parts stays one (compose-pictures.ts).
// Plain text the browser inserts itself: it cannot load anything. New code.
import type { Draft, DraftHtml } from 'ooxml-core/mail';
import { cidUrlsOf } from './compose-pictures';
import { sanitizeEmailHtml, sanitizeMessageHtml, type SanitizedHtml } from './sanitize';

/** What the editor keeps of the draft's own pictures in the HTML it takes (compose-pictures.ts). */
export interface EditorPictures {
	/** For the sanitiser: each part's `cid:` URL by its Content-ID (lower case), kept as it is. */
	readonly cidUrls: ReadonlyMap<string, string>;
	/** `markup` with the draft's pictures in it as their `cid:` URLs. */
	refer(markup: string): string;
}

const escapeHtml = (text: string): string =>
	text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** What the editor shows for a draft: its HTML through the sanitiser, else its text as lines. */
export function editorHtml(draft: Pick<Draft, 'html' | 'text'>, pictures: EditorPictures): string {
	return draft.html
		? sanitizeEmailHtml(draft.html, { allowRemote: false, cidUrls: pictures.cidUrls }).body
		: escapeHtml(draft.text).replace(/\r?\n/g, '<br>');
}

/**
 * The cleaned body of a message, in a block with the direction and language its body has (its own,
 * else its html element's) when it has either: the editor takes only the content of a body.
 */
function inOwnDirection({ body, htmlAttributes, bodyAttributes }: SanitizedHtml): string {
	const attributes = (['dir', 'lang'] as const)
		.map((name) => [name, bodyAttributes[name] ?? htmlAttributes[name]] as const)
		.map(([name, value]) => (value === undefined ? '' : ` ${name}="${escapeHtml(value)}"`))
		.join('');
	return attributes ? `<div${attributes}>${body}</div>` : body;
}

/**
 * A message's HTML body as a draft holds it (`DraftHtml`): the quote of a reply or forward, or a
 * saved draft opened again. A body sent in several parts is cleaned part by part, as the reading
 * pane shows it, so the editor, which parses the draft's HTML as one text, gets every part. Remote
 * images and styles go, as the editor shows neither, and a `cid:` picture stays one only for a part
 * in `parts`; the direction and language of the body stay (`inOwnDirection`), so a quote of a
 * message written right to left stays so. Null without HTML; where there is no DOM to clean it in,
 * the HTML as sent.
 */
export const draftHtml: DraftHtml = (message, parts) => {
	if (!message.html) return null;
	if (typeof DOMParser === 'undefined' || typeof document === 'undefined') return message.html;
	return inOwnDirection(
		sanitizeMessageHtml(message, { allowRemote: false, cidUrls: cidUrlsOf(parts) }),
	);
};

export function caretToStart(doc: Document, editor: HTMLElement): void {
	const selection = doc.getSelection();
	if (!selection) return;
	const range = doc.createRange();
	range.setStart(editor, 0);
	range.collapse(true);
	selection.removeAllRanges();
	selection.addRange(range);
}

const insertClean = (doc: Document, markup: string, pictures: EditorPictures): void => {
	const clean = sanitizeEmailHtml(pictures.refer(markup), {
		allowRemote: false,
		cidUrls: pictures.cidUrls,
	});
	doc.execCommand('insertHTML', false, clean.body);
};

/** A paste of HTML, inserted clean instead of as the browser would; true when it was. */
export function pasteClean(
	event: ClipboardEvent,
	doc: Document,
	pictures: EditorPictures,
): boolean {
	const markup = event.clipboardData?.getData('text/html');
	if (!markup) return false;
	event.preventDefault();
	insertClean(doc, markup, pictures);
	return true;
}

/**
 * Where a drop at (`x`, `y`) lands in the editor, as the caret: the point under it (through the
 * editor's shadow root where the browser can look into one), else where the caret already is in the
 * editor, else the end.
 */
function caretAtDrop(editor: HTMLElement, x: number, y: number): void {
	const doc = editor.ownerDocument;
	const selection = doc.getSelection();
	if (!selection) return;
	const root = editor.getRootNode();
	const point = doc.caretPositionFromPoint?.(
		x,
		y,
		root instanceof ShadowRoot ? { shadowRoots: [root] } : undefined,
	);
	let range: Range | null = null;
	if (point && editor.contains(point.offsetNode)) {
		range = doc.createRange();
		range.setStart(point.offsetNode, point.offset);
	} else {
		const fallback = doc.caretRangeFromPoint?.(x, y);
		if (fallback && editor.contains(fallback.startContainer)) range = fallback;
	}
	if (!range) {
		const current = selection.rangeCount ? selection.getRangeAt(0) : null;
		if (current && editor.contains(current.startContainer)) return;
		range = doc.createRange();
		range.selectNodeContents(editor);
		range.collapse(false);
	}
	range.collapse(true);
	selection.removeAllRanges();
	selection.addRange(range);
}

/**
 * HTML dropped into the editor from elsewhere (another page, the reading pane), inserted clean at
 * the drop point instead of by the browser; true when it was. The drop event is the one to take:
 * a browser can send the `beforeinput` of a drop to the shadow host, outside the editor. A move
 * inside the editor (`moving`) stays the browser's: it moves the editor's own, already clean,
 * content, and it takes the text out of where it was.
 */
export function dropClean(
	event: DragEvent,
	editor: HTMLElement,
	moving: boolean,
	pictures: EditorPictures,
): boolean {
	const markup = event.dataTransfer?.getData('text/html');
	const target = event.composedPath()[0];
	if (moving || !markup || !(target instanceof Node) || !editor.contains(target)) return false;
	event.preventDefault();
	caretAtDrop(editor, event.clientX, event.clientY);
	insertClean(editor.ownerDocument, markup, pictures);
	return true;
}
