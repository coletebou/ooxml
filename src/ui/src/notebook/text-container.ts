// <notebook-text>: the rich-text editor of one text container. The editor state (schema, keymap,
// input rules, y-prosemirror binding to the container's shared text) comes from
// `ooxml-core/notebook/editor`; this element only owns the view, the to-do checkboxes (widgets
// a click or Mod-Enter ticks) and the DOM of collaborators' carets, coloured from the sanitised
// peer list. Formats, focus, undo and link requests go out as events.
import { html } from 'lit';
import type { PeerView, TextBinding } from 'ooxml-core/notebook';
import {
	type ActiveFormats,
	activeFormats,
	createNotebookEditorState,
	refreshRemoteCursors,
	setTodoAt,
} from 'ooxml-core/notebook/editor';
import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { controlStyles } from '../base';
import { definer } from '../registry';
import { NotebookElement } from './base';
import css from './text-container.css?raw';

export interface TextFocusDetail {
	id: string;
	view: EditorView;
}

const todoPlugin = (label: (done: boolean) => string): Plugin =>
	new Plugin({
		props: {
			decorations(state) {
				const widgets: Decoration[] = [];
				state.doc.descendants((node, pos) => {
					const todo = node.attrs.todo;
					if (!node.isTextblock || (todo !== 'open' && todo !== 'done')) return;
					widgets.push(
						Decoration.widget(
							pos + 1,
							() => {
								const box = document.createElement('span');
								box.className = 'todo-box';
								box.contentEditable = 'false';
								box.dataset.todo = todo;
								box.dataset.pos = String(pos);
								box.setAttribute('role', 'checkbox');
								box.setAttribute('aria-checked', String(todo === 'done'));
								box.setAttribute('aria-label', label(todo === 'done'));
								return box;
							},
							{ side: -1, ignoreSelection: true, key: `todo-${pos}-${todo}` },
						),
					);
				});
				return DecorationSet.create(state.doc, widgets);
			},
			handleDOMEvents: {
				mousedown(view, event) {
					const box = (event.target as HTMLElement | null)?.closest?.(
						'.todo-box',
					) as HTMLElement | null;
					if (!box) return false;
					event.preventDefault();
					const pos = Number(box.dataset.pos);
					setTodoAt(pos, box.dataset.todo === 'done' ? 'open' : 'done')(view.state, view.dispatch);
					return true;
				},
			},
		},
	});

/**
 * y-prosemirror measures the local selection with `view._root.createRange()` when it applies a
 * collaborator's change; a ShadowRoot has no `createRange`, so the change threw while being
 * applied and was lost (y-prosemirror 1.3.7). This view's own root gets the document's (scoped to
 * that root: no prototype or global is changed).
 */
function shadowRootRanges(view: EditorView): void {
	const root = view.root as Document | (ShadowRoot & { createRange?: unknown });
	if (typeof root.createRange === 'function') return;
	const doc = root.ownerDocument;
	Object.defineProperty(root, 'createRange', {
		value: () => doc.createRange(),
		configurable: true,
	});
}

export class NotebookText extends NotebookElement {
	static override styles = controlStyles(css);
	static override properties = {
		containerId: { type: String, attribute: 'container-id' },
		binding: { attribute: false },
		peers: { attribute: false },
		autofocus: { type: Boolean },
	};
	declare containerId: string;
	declare binding: TextBinding | null;
	declare peers: readonly PeerView[];
	declare autofocus: boolean;
	#view: EditorView | null = null;
	#bound: TextBinding | null = null;

	constructor() {
		super();
		this.containerId = '';
		this.binding = null;
		this.peers = [];
		this.autofocus = false;
	}

	/** The ProseMirror view, for the ribbon's commands. */
	get view(): EditorView | null {
		return this.#view;
	}

	/** True while the container holds no text, list, heading or to-do tag. */
	isEmpty(): boolean {
		const doc = this.#view?.state.doc;
		if (!doc) return false;
		const first = doc.firstChild;
		return (
			doc.childCount === 1 &&
			!!first &&
			first.type.name === 'paragraph' &&
			!first.attrs.todo &&
			first.content.size === 0
		);
	}

	focusEnd(): void {
		const view = this.#view;
		if (!view) return;
		view.focus();
	}

	protected override render() {
		return html`<div class="editor" part="editor"></div>`;
	}

	protected override updated(changed: Map<string, unknown>): void {
		if (changed.has('binding') && this.binding !== this.#bound) this.#mount();
		if (changed.has('peers') && this.#view)
			this.#view.dispatch(refreshRemoteCursors(this.#view.state));
		if (changed.has('autofocus') && this.autofocus) queueMicrotask(() => this.focusEnd());
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this.#destroy();
	}

	override connectedCallback(): void {
		super.connectedCallback();
		if (this.hasUpdated && this.binding && !this.#view) this.#mount();
	}

	#destroy(): void {
		this.#view?.destroy();
		this.#view = null;
		this.#bound = null;
	}

	#peer(clientId: number): { name: string; color: string } {
		const peer = this.peers.find((p) => p.clientId === clientId);
		return { name: peer?.name || this.t('peer.someone'), color: peer?.color ?? '#808080' };
	}

	#mount(): void {
		this.#destroy();
		const binding = this.binding;
		const host = this.renderRoot.querySelector<HTMLElement>('.editor');
		if (!binding || !host) return;
		this.#bound = binding;
		const fire = <T>(type: string, detail: T): void => void this.fire(type, detail);
		const state = createNotebookEditorState({
			fragment: binding.fragment,
			undo: binding.undo,
			awareness: binding.awareness,
			onUndo: () => fire('nb-undo', {}),
			onRedo: () => fire('nb-redo', {}),
			onLink: () => (fire('nb-link-request', { id: this.containerId }), true),
			cursorBuilder: (_user, clientId) => {
				const { name, color } = this.#peer(clientId);
				const caret = document.createElement('span');
				caret.className = 'remote-caret';
				// A name inside the text would be read as text; the caret is decoration.
				caret.setAttribute('aria-hidden', 'true');
				caret.style.borderColor = color;
				const label = document.createElement('span');
				label.className = 'remote-label';
				label.style.backgroundColor = color;
				label.textContent = name;
				caret.append(label);
				return caret;
			},
			selectionBuilder: (_user, clientId) => ({
				class: 'remote-selection',
				style: `background-color: ${this.#peer(clientId).color}33`,
			}),
			plugins: [todoPlugin((done) => this.t(done ? 'todos.done' : 'todos.notDone'))],
		});
		const view = new EditorView(host, {
			state,
			attributes: {
				'aria-label': this.t('container.text'),
				'aria-multiline': 'true',
				role: 'textbox',
			},
			dispatchTransaction: (tr) => {
				// y-prosemirror can deliver a queued caret update after the view was destroyed (its
				// binding never marks itself destroyed); there is nothing left to update then.
				if (view.isDestroyed) return;
				view.updateState(view.state.apply(tr));
				fire('nb-format', {
					id: this.containerId,
					formats: activeFormats(view.state) satisfies ActiveFormats,
				});
			},
			handleDOMEvents: {
				focus: () => (
					fire('nb-text-focus', { id: this.containerId, view } satisfies TextFocusDetail),
					false
				),
				blur: () => (fire('nb-text-blur', { id: this.containerId }), false),
				keydown: (_view, event) => {
					if (event.key !== 'Escape') return false;
					fire('nb-text-escape', { id: this.containerId });
					return true;
				},
			},
			handlePaste: (_view, event) => {
				const files = [...(event.clipboardData?.files ?? [])];
				if (!files.length) return false;
				fire('nb-paste-files', { id: this.containerId, files });
				return true;
			},
		});
		shadowRootRanges(view);
		this.#view = view;
		if (this.autofocus) queueMicrotask(() => this.focusEnd());
	}
}

export const defineNotebookText = definer('notebook-text', () => NotebookText);
