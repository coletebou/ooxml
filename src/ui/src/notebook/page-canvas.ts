// <notebook-page>: one page. A title and its creation date on top, then the free-form canvas:
// click anywhere to place a text container, drag a container by its grip, resize it from its
// corner, drop or paste pictures and files, and draw on the ink layer above. A move or resize
// previews locally and commits once on release (one undo step, one update for collaborators).
// Containers a collaborator is in carry their colour and name.
import { html, nothing, unsafeCSS } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';
import type {
	Container,
	NotebookClient,
	NotebookState,
	PeerView,
	TextBinding,
} from 'ooxml-core/notebook';
import { richTextFromPlain } from 'ooxml-core/notebook';
import { controlStyles } from '../base';
import { trackPointerGesture } from '../pointer-gesture';
import { OFFICE_TOKENS } from '../tokens';
import { definer } from '../registry';
import { NotebookElement } from './base';
import { defineNotebookFile } from './file-embed';
import { formatCreated } from './i18n/translator';
import { defineNotebookInk, type StrokeDetail } from './ink-layer';
import { composing } from './keys';
import { belowContent, placeFiles } from './page-files';
import { type NotebookText, defineNotebookText } from './text-container';
import css from './page-canvas.css?raw';

export type NotebookTool = 'type' | 'pen' | 'highlighter' | 'eraser';
interface Drag {
	id: string;
	mode: 'move' | 'resize';
	dx: number;
	dy: number;
	width: number;
	height: number;
}

// The page is paper in every theme, as a Word page is: the token defaults (the light values) apply
// inside it, so text, ink and highlights look as they print and export, while the app's chrome
// follows the theme.
const PAPER = `:host{${Object.entries(OFFICE_TOKENS)
	.map(([name, value]) => `${name}:${value}`)
	.join(';')}}`;

export class NotebookPage extends NotebookElement {
	static override styles = [unsafeCSS(PAPER), ...controlStyles(css)];
	static override properties = {
		client: { attribute: false },
		state: { attribute: false },
		tool: { type: String },
		inkColor: { attribute: false },
		inkWidth: { attribute: false },
		zoom: { type: Number },
		focusId: { attribute: false },
		selectedId: { state: true },
		drag: { state: true },
	};
	declare client: NotebookClient | null;
	declare state: NotebookState | null;
	declare tool: NotebookTool;
	declare inkColor: string;
	declare inkWidth: number;
	declare zoom: number;
	/** A container to focus once it is on screen (set by the host after it creates one). */
	declare focusId: string;
	declare selectedId: string;
	declare drag: Drag | null;
	#bindings = new Map<string, TextBinding>();
	#assets = new Map<string, { bytes: Uint8Array; url?: string }>();
	#title: string | null = null;
	/** Where the person last clicked on this page: pasted items go there, else below the content. */
	#lastPoint: { x: number; y: number } | null = null;
	#page = '';

	constructor() {
		super();
		this.client = null;
		this.state = null;
		this.tool = 'type';
		this.inkColor = '#202020';
		this.inkWidth = 2;
		this.zoom = 1;
		this.focusId = '';
		this.selectedId = '';
		this.drag = null;
	}

	/** Text containers on screen with nothing in them (swept when the person clicks elsewhere). */
	emptyTextIds(except = ''): string[] {
		return [...this.renderRoot.querySelectorAll<NotebookText>('notebook-text')]
			.filter((el) => el.containerId !== except && el.isEmpty())
			.map((el) => el.containerId);
	}

	/** Where something new goes on this page: below its content as drawn (text grows as it fills). */
	nextSpot(): { x: number; y: number } {
		return belowContent(this.state?.containers ?? [], this.#drawnHeights());
	}

	#drawnHeights(): Map<string, number> {
		const drawn = new Map<string, number>();
		for (const frame of this.renderRoot.querySelectorAll<HTMLElement>('.frame[data-id]'))
			drawn.set(frame.dataset['id'] ?? '', frame.offsetHeight);
		return drawn;
	}

	/** Add picked files below what is on the page (a drop lands where it was dropped). */
	insertFiles(files: readonly File[]): Promise<void> {
		return this.#addFiles(files, this.nextSpot());
	}

	focusTitle(): void {
		this.renderRoot.querySelector<HTMLInputElement>('input.title')?.focus();
	}

	// Text boxes grow with their content; the page is sized (and new items placed) from what is drawn.
	#resized =
		typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.requestUpdate()) : null;

	protected override updated(): void {
		for (const frame of this.renderRoot.querySelectorAll('.frame.text'))
			this.#resized?.observe(frame);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this.#resized?.disconnect();
		for (const asset of this.#assets.values()) if (asset.url) URL.revokeObjectURL(asset.url);
		this.#assets.clear();
		this.#bindings.clear();
	}

	protected override willUpdate(): void {
		const pageId = this.state?.pageId ?? '';
		if (pageId !== this.#page) {
			this.#page = pageId;
			this.#title = null;
			this.#lastPoint = null;
			this.selectedId = '';
		}
		// Forget what left the page (revoke picture URLs), keep what stays.
		const ids = new Set(this.state?.containers.map((c) => c.id));
		for (const [id, asset] of this.#assets)
			if (!ids.has(id)) {
				if (asset.url) URL.revokeObjectURL(asset.url);
				this.#assets.delete(id);
			}
		for (const id of this.#bindings.keys()) if (!ids.has(id)) this.#bindings.delete(id);
	}

	#binding(id: string): TextBinding | null {
		const fresh = this.client?.textBinding(id) ?? null;
		const known = this.#bindings.get(id);
		if (known && fresh && known.fragment === fresh.fragment) return known;
		if (fresh) this.#bindings.set(id, fresh);
		else this.#bindings.delete(id);
		return fresh;
	}

	#asset(c: Container): { bytes: Uint8Array; url?: string } | null {
		let asset = this.#assets.get(c.id);
		if (!asset) {
			const bytes = this.client?.containerBytes(c.id);
			if (!bytes) return null;
			asset = { bytes };
			if (c.kind === 'image')
				asset.url = URL.createObjectURL(new Blob([bytes.slice()], { type: c.mime }));
			this.#assets.set(c.id, asset);
		}
		return asset;
	}

	/** A point on the canvas in page pixels. */
	#at(event: { clientX: number; clientY: number }): { x: number; y: number } {
		const surface = this.renderRoot.querySelector<HTMLElement>('.surface');
		const rect = surface?.getBoundingClientRect();
		if (!rect) return { x: 0, y: 0 };
		return {
			x: (event.clientX - rect.left) / this.zoom,
			y: (event.clientY - rect.top) / this.zoom,
		};
	}

	#surfaceDown(event: PointerEvent): void {
		if (event.button !== 0 || this.tool !== 'type' || event.target !== event.currentTarget) return;
		const client = this.client;
		if (!client || !this.state?.page) return;
		event.preventDefault();
		const at = this.#at(event);
		this.#lastPoint = at;
		// Empty text boxes are swept away, except one a collaborator is in (about to type).
		const busy = new Set(
			this.state.peers.filter((p) => p.pageId === this.state?.pageId).map((p) => p.containerId),
		);
		const empty = this.emptyTextIds().filter((id) => !busy.has(id));
		if (empty.length) client.deleteContainers(empty);
		this.selectedId = '';
		const id = client.addText({ x: Math.max(0, at.x - 8), y: Math.max(0, at.y - 12) });
		if (id) this.focusId = id;
	}

	async #addFiles(files: readonly File[], at: { x: number; y: number }): Promise<void> {
		const client = this.client;
		if (!client || !files.length) return;
		// Reading the files takes a while; they go to the page they were dropped on, also if the
		// person moved on (and nowhere when that page is in another notebook by then).
		const page = this.state?.pageId;
		const { placed: items, tooLarge } = await placeFiles(files, at);
		if (tooLarge) this.fire('nb-notice', { code: 'file-too-large' });
		for (const placed of items) {
			const id =
				placed.kind === 'image'
					? client.addImage(placed.input, page)
					: client.addFile(placed.input, page);
			if (id) this.selectedId = id;
		}
	}

	#paste(event: ClipboardEvent): void {
		const inEditor = event.composedPath().some((n) => {
			const el = n as HTMLElement;
			// Text containers and fields (the page title) paste on their own.
			return (
				el.tagName === 'NOTEBOOK-TEXT' || el.tagName === 'INPUT' || el.isContentEditable === true
			);
		});
		if (inEditor || this.tool !== 'type') return;
		const files = [...(event.clipboardData?.files ?? [])];
		if (files.length) {
			event.preventDefault();
			void this.#addFiles(files, this.#pastePoint());
			return;
		}
		const text = event.clipboardData?.getData('text/plain') ?? '';
		if (!text.trim() || !this.client) return;
		event.preventDefault();
		const id = this.client.addText(this.#pastePoint(), richTextFromPlain(text));
		if (id) this.focusId = id;
	}

	#pastePoint(): { x: number; y: number } {
		return this.#lastPoint ?? this.nextSpot();
	}

	#drop(event: DragEvent): void {
		const files = [...(event.dataTransfer?.files ?? [])];
		if (!files.length) return;
		event.preventDefault();
		void this.#addFiles(files, this.#at(event));
	}

	#startDrag(event: PointerEvent, c: Container, mode: Drag['mode']): void {
		if (event.button !== 0 || !this.client) return;
		event.preventDefault();
		event.stopPropagation();
		const owner = event.currentTarget as HTMLElement;
		owner.setPointerCapture?.(event.pointerId);
		const start = { x: event.clientX, y: event.clientY };
		this.selectedId = c.id;
		this.drag = { id: c.id, mode, dx: 0, dy: 0, width: c.width, height: c.height };
		trackPointerGesture(owner, event.pointerId, {
			move: (e) => {
				const dx = (e.clientX - start.x) / this.zoom;
				const dy = (e.clientY - start.y) / this.zoom;
				this.drag =
					mode === 'move'
						? { ...this.drag!, dx, dy }
						: {
								...this.drag!,
								width: Math.max(40, c.width + dx),
								height: Math.max(16, c.height + dy),
							};
			},
			commit: () => {
				const drag = this.drag;
				this.drag = null;
				if (!drag || !this.client) return;
				if (mode === 'move' && (Math.round(drag.dx) || Math.round(drag.dy)))
					this.client.moveContainers([c.id], Math.round(drag.dx), Math.round(drag.dy));
				if (mode === 'resize')
					this.client.resizeContainer(c.id, {
						width: Math.round(drag.width),
						...(c.kind === 'text' ? {} : { height: Math.round(drag.height) }),
					});
			},
			cancel: () => (this.drag = null),
		});
	}

	#frameKey(event: KeyboardEvent, c: Container): void {
		if (event.target !== event.currentTarget || !this.client) return;
		const step = event.shiftKey ? 10 : 1;
		const moves: Record<string, [number, number]> = {
			ArrowLeft: [-step, 0],
			ArrowRight: [step, 0],
			ArrowUp: [0, -step],
			ArrowDown: [0, step],
		};
		const move = moves[event.key];
		if (move) {
			event.preventDefault();
			this.client.moveContainers([c.id], move[0], move[1]);
		} else if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault();
			this.client.deleteContainers([c.id]);
			this.selectedId = '';
		} else if (event.key === 'Escape') {
			this.selectedId = '';
			(event.currentTarget as HTMLElement).blur();
		} else if (event.key === 'Enter' && c.kind === 'text') {
			event.preventDefault();
			this.focusId = c.id;
		}
	}

	#select(id: string, frame: HTMLElement | null): void {
		this.selectedId = id;
		frame?.focus();
	}

	#frame(c: Container, index: number, peers: readonly PeerView[]) {
		const peer = peers.find((p) => p.pageId === this.state?.pageId && p.containerId === c.id);
		const drag = this.drag?.id === c.id ? this.drag : null;
		const name = c.kind === 'text' ? this.t('container.text') : c.name;
		const width = drag?.width ?? c.width;
		const height = drag?.height ?? c.height;
		const style =
			`left:${c.x + (drag?.dx ?? 0)}px;top:${c.y + (drag?.dy ?? 0)}px;width:${width}px;` +
			`${c.kind === 'text' ? '' : `height:${height}px;`}z-index:${index + 1};` +
			(peer ? `--peer:${peer.color};` : '');
		const label =
			c.kind === 'image'
				? this.t('container.picture', { name: c.name })
				: c.kind === 'file'
					? this.t('container.file', { name: c.name })
					: this.t('container.text');
		return html`<div
			class=${classMap({ frame: true, [c.kind]: true, selected: c.id === this.selectedId, dragging: !!drag, peer: !!peer })}
			data-id=${c.id}
			style=${style}
			tabindex=${c.kind === 'text' ? -1 : 0}
			role="group"
			aria-label=${label}
			@keydown=${(e: KeyboardEvent) => this.#frameKey(e, c)}
			@contextmenu=${(e: MouseEvent) => {
				e.preventDefault();
				this.selectedId = c.id;
				this.fire('nb-container-menu', { id: c.id, x: e.clientX, y: e.clientY });
			}}
			@pointerdown=${(e: PointerEvent) => {
				if (c.kind !== 'text' && e.button === 0 && this.tool === 'type')
					this.#select(c.id, e.currentTarget as HTMLElement);
			}}
		>
			<div
				class="grip"
				title=${this.t('container.move', { name })}
				@pointerdown=${(e: PointerEvent) => this.#startDrag(e, c, 'move')}
			></div>
			${this.#content(c, peers)}
			<div
				class="resize"
				title=${this.t('container.resize', { name })}
				@pointerdown=${(e: PointerEvent) => this.#startDrag(e, c, 'resize')}
			></div>
			${peer ? html`<span class="peer-tag">${this.t('container.editing', { name: peer.name || this.t('peer.someone') })}</span>` : nothing}
		</div>`;
	}

	#content(c: Container, peers: readonly PeerView[]) {
		if (c.kind === 'text')
			return html`<notebook-text
				container-id=${c.id}
				.binding=${this.#binding(c.id)}
				.peers=${peers}
				.locale=${this.locale}
				?autofocus=${this.focusId === c.id}
				@nb-text-focus=${() => {
					this.selectedId = c.id;
					if (this.focusId === c.id) this.focusId = '';
				}}
				@nb-text-escape=${(e: Event) => this.#select(c.id, (e.currentTarget as HTMLElement).closest('.frame'))}
				@nb-paste-files=${(e: CustomEvent<{ files: File[] }>) => void this.#addFiles(e.detail.files, { x: c.x + 24, y: c.y + 48 })}
			></notebook-text>`;
		if (c.kind === 'image') {
			const asset = this.#asset(c);
			return asset?.url
				? html`<img src=${asset.url} alt=${c.alt || c.name} draggable="false" />`
				: nothing;
		}
		return html`<notebook-file
			.container=${c}
			.bytes=${this.#asset(c)?.bytes ?? null}
			.locale=${this.locale}
		></notebook-file>`;
	}

	#extent(state: NotebookState): { width: number; height: number } {
		let right = 960;
		let bottom = 720;
		const drawn = this.#drawnHeights();
		for (const c of state.containers) {
			right = Math.max(right, c.x + c.width + 320);
			bottom = Math.max(bottom, c.y + (drawn.get(c.id) || c.height || 240) + 320);
		}
		for (const s of state.strokes)
			for (let i = 0; i + 1 < s.points.length; i += 3) {
				right = Math.max(right, (s.points[i] ?? 0) + 320);
				bottom = Math.max(bottom, (s.points[i + 1] ?? 0) + 320);
			}
		return { width: Math.ceil(right), height: Math.ceil(bottom) };
	}

	protected override render() {
		const state = this.state;
		const page = state?.page;
		if (!state || !page)
			return html`<div class="none">
				<p>${this.t('page.none')}</p>
				<office-ui-button
					command="add-page"
					icon="plus"
					label=${this.t('page.add')}
					@office-command=${() => this.fire('nb-add-page', {})}
				></office-ui-button>
			</div>`;
		const size = this.#extent(state);
		const created = formatCreated(page.created, this.i18n);
		const inkTool = this.tool === 'type' ? '' : this.tool;
		return html`<div class="scroller" @paste=${(e: ClipboardEvent) => this.#paste(e)}>
			<div
				class="sizer"
				style=${`width:${size.width * this.zoom}px;height:${(size.height + 120) * this.zoom}px`}
			>
				<div class="paper" style=${`width:${size.width}px;transform:scale(${this.zoom})`}>
					<header class="head">
						<input
							class="title"
							.value=${this.#title ?? page.title}
							placeholder=${this.t('page.untitled')}
							aria-label=${this.t('page.title')}
							@focus=${(e: Event) => (this.#title = (e.target as HTMLInputElement).value)}
							@blur=${() => {
								this.#title = null;
								this.requestUpdate();
							}}
							@input=${(e: Event) => {
								this.#title = (e.target as HTMLInputElement).value;
								this.client?.renamePage(page.id, this.#title);
							}}
							@keydown=${(e: KeyboardEvent) => e.key === 'Enter' && !composing(e) && (e.target as HTMLInputElement).blur()}
						/>
						<div class="created" title=${this.t('page.created')}>
							<span>${created.date}</span><span>${created.time}</span>
						</div>
					</header>
					<div
						class="surface"
						role="region"
						aria-label=${this.t('page.canvas')}
						style=${`height:${size.height}px`}
						@pointerdown=${(e: PointerEvent) => this.#surfaceDown(e)}
						@dragover=${(e: DragEvent) => {
							if ([...(e.dataTransfer?.types ?? [])].includes('Files')) e.preventDefault();
						}}
						@drop=${(e: DragEvent) => this.#drop(e)}
					>
						<div class="frames">
							${repeat(
								state.containers,
								(c) => c.id,
								(c, i) => this.#frame(c, i, state.peers),
							)}
						</div>
						<notebook-ink
							.strokes=${state.strokes}
							.tool=${inkTool}
							.color=${this.inkColor}
							.width=${this.inkWidth}
							.locale=${this.locale}
							@nb-stroke=${(e: CustomEvent<StrokeDetail>) => this.client?.addStroke(e.detail)}
							@nb-erase=${(e: CustomEvent<{ ids: string[] }>) => this.client?.eraseStrokes(e.detail.ids)}
						></notebook-ink>
						${state.containers.length || state.strokes.length ? nothing : html`<p class="hint">${this.t('page.hint')}</p>`}
					</div>
				</div>
			</div>
		</div>`;
	}
}

export const defineNotebookPage = definer('notebook-page', () => NotebookPage, [
	defineNotebookText,
	defineNotebookInk,
	defineNotebookFile,
]);
