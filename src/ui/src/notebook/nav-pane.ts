// <notebook-nav>: the navigation pane. The open notebook (a button that opens the notebook
// menu), search, the section tree (coloured tabs, collapsible groups) and the selected section's
// pages (subpages indented). Arrow keys move between items, Enter opens, F2 renames, Delete
// deletes, Alt+Arrow moves an item, the context-menu key opens its menu; items also drag. Every
// change is an event the app turns into a client action.
import { html, nothing } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import type { NotebookState, PageView, SearchHit, SectionView } from 'ooxml-core/notebook';
import { controlStyles } from '../base';
import { glyph } from '../glyph';
import { definer } from '../registry';
import { NotebookElement } from './base';
import css from './nav-pane.css?raw';

export type NavItemKind = 'section' | 'group' | 'page' | 'notebook';
const DRAG_TYPE = 'application/x-ooxml-notebook-item';

export class NotebookNav extends NotebookElement {
	static override styles = controlStyles(css);
	static override properties = {
		state: { attribute: false },
		editing: { state: true },
		collapsed: { state: true },
	};
	declare state: NotebookState | null;
	declare editing: { kind: NavItemKind; id: string } | null;
	declare collapsed: ReadonlySet<string>;

	constructor() {
		super();
		this.state = null;
		this.editing = null;
		this.collapsed = new Set();
	}

	/** Turn an item's label into a text field (Rename in a menu, F2, double-click). */
	startRename(kind: NavItemKind, id: string): void {
		this.editing = { kind, id };
		void this.updateComplete.then(() => {
			const input = this.renderRoot.querySelector<HTMLInputElement>('input.rename');
			input?.focus();
			input?.select();
		});
	}

	focusSearch(): void {
		this.renderRoot.querySelector<HTMLElement>('office-ui-search')?.focus();
	}

	#commit(kind: NavItemKind, id: string, value: string): void {
		if (!this.editing) return;
		this.editing = null;
		if (value.trim()) this.fire('nb-rename', { kind, id, name: value });
	}

	#visibleSections(sections: readonly SectionView[]): SectionView[] {
		const hidden = new Set<string>();
		return sections.filter((s) => {
			if (hidden.has(s.parentId) || this.collapsed.has(s.parentId)) {
				hidden.add(s.id);
				return false;
			}
			return true;
		});
	}

	#keys(event: KeyboardEvent, kind: NavItemKind, id: string): void {
		const item = event.currentTarget as HTMLElement;
		if (event.target !== item) return;
		const items = [
			...(item.parentElement?.querySelectorAll<HTMLElement>(':scope > [data-id]') ?? []),
		];
		const at = items.indexOf(item);
		const focus = (el: HTMLElement | undefined): void => {
			if (!el) return;
			for (const other of items) other.tabIndex = other === el ? 0 : -1;
			el.focus();
		};
		const open = (): void => {
			if (kind === 'page') this.fire('nb-select-page', { id });
			else if (kind === 'section') this.fire('nb-select-section', { id });
			else this.#toggle(id);
		};
		const menu = (): void => {
			const rect = item.getBoundingClientRect();
			this.fire('nb-item-menu', { kind, id, x: rect.left + rect.width / 2, y: rect.bottom });
		};
		const actions: Record<string, () => void> = {
			ArrowDown: () => focus(items[at + 1]),
			ArrowUp: () => focus(items[at - 1]),
			Home: () => focus(items[0]),
			End: () => focus(items.at(-1)),
			Enter: open,
			' ': open,
			F2: () => this.startRename(kind, id),
			Delete: () => this.fire('nb-delete-item', { kind, id }),
			ContextMenu: menu,
		};
		if (kind === 'group') {
			actions.ArrowRight = () => this.collapsed.has(id) && this.#toggle(id);
			actions.ArrowLeft = () => !this.collapsed.has(id) && this.#toggle(id);
		}
		const action =
			event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')
				? () => this.fire('nb-move-item', { kind, id, direction: event.key === 'ArrowUp' ? -1 : 1 })
				: event.shiftKey && event.key === 'F10'
					? menu
					: actions[event.key];
		if (!action) return;
		event.preventDefault();
		event.stopPropagation();
		action();
	}

	#toggle(id: string): void {
		const next = new Set(this.collapsed);
		if (!next.delete(id)) next.add(id);
		this.collapsed = next;
	}

	#drag(kind: NavItemKind, id: string) {
		return {
			start: (e: DragEvent) => {
				e.dataTransfer?.setData(DRAG_TYPE, JSON.stringify({ kind, id }));
				if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
			},
			over: (e: DragEvent) => {
				if ([...(e.dataTransfer?.types ?? [])].includes(DRAG_TYPE)) e.preventDefault();
			},
			drop: (e: DragEvent) => {
				const raw = e.dataTransfer?.getData(DRAG_TYPE);
				if (!raw) return;
				e.preventDefault();
				const source = JSON.parse(raw) as { kind: NavItemKind; id: string };
				if (source.id !== id) this.fire('nb-drop-item', { source, target: { kind, id } });
			},
		};
	}

	#label(kind: NavItemKind, id: string, name: string, placeholder: string) {
		if (this.editing?.kind === kind && this.editing.id === id)
			return html`<input
				class="rename"
				.value=${name}
				aria-label=${this.t('nav.rename')}
				@click=${(e: Event) => e.stopPropagation()}
				@keydown=${(e: KeyboardEvent) => {
					e.stopPropagation();
					if (e.key === 'Enter') this.#commit(kind, id, (e.target as HTMLInputElement).value);
					if (e.key === 'Escape') this.editing = null;
				}}
				@blur=${(e: Event) => this.#commit(kind, id, (e.target as HTMLInputElement).value)}
			/>`;
		return html`<span class=${classMap({ label: true, placeholder: !name })}
			>${name || placeholder}</span
		>`;
	}

	#section(s: SectionView, selected: string) {
		const kind: NavItemKind = s.kind === 'group' ? 'group' : 'section';
		const drag = this.#drag(kind, s.id);
		const open = !this.collapsed.has(s.id);
		return html`<li
			class=${classMap({ item: true, [kind]: true, selected: s.id === selected })}
			data-id=${s.id}
			role="treeitem"
			aria-level=${s.depth + 1}
			aria-selected=${kind === 'section' ? String(s.id === selected) : nothing}
			aria-expanded=${kind === 'group' ? String(open) : nothing}
			tabindex=${s.id === selected ? 0 : -1}
			style=${`--tab:${s.color};--depth:${s.depth}`}
			draggable="true"
			@click=${() => (kind === 'group' ? this.#toggle(s.id) : this.fire('nb-select-section', { id: s.id }))}
			@dblclick=${() => this.startRename(kind, s.id)}
			@contextmenu=${(e: MouseEvent) => (e.preventDefault(), this.fire('nb-item-menu', { kind, id: s.id, x: e.clientX, y: e.clientY }))}
			@keydown=${(e: KeyboardEvent) => this.#keys(e, kind, s.id)}
			@dragstart=${drag.start}
			@dragover=${drag.over}
			@drop=${drag.drop}
		>
			${kind === 'group' ? html`<span class="twisty" aria-hidden="true">${glyph(open ? 'chevronDown' : 'chevronRight')}</span>` : html`<span class="tab" aria-hidden="true"></span>`}
			${this.#label(kind, s.id, s.name, '')}
		</li>`;
	}

	#page(p: PageView, selected: string) {
		const drag = this.#drag('page', p.id);
		return html`<li
			class=${classMap({ item: true, page: true, selected: p.id === selected })}
			data-id=${p.id}
			role="option"
			aria-selected=${String(p.id === selected)}
			tabindex=${p.id === selected ? 0 : -1}
			style=${`--level:${p.level}`}
			draggable="true"
			@click=${() => this.fire('nb-select-page', { id: p.id })}
			@dblclick=${() => this.startRename('page', p.id)}
			@contextmenu=${(e: MouseEvent) => (e.preventDefault(), this.fire('nb-item-menu', { kind: 'page', id: p.id, x: e.clientX, y: e.clientY }))}
			@keydown=${(e: KeyboardEvent) => this.#keys(e, 'page', p.id)}
			@dragstart=${drag.start}
			@dragover=${drag.over}
			@drop=${drag.drop}
		>
			${this.#label('page', p.id, p.title, this.t('page.untitled'))}
		</li>`;
	}

	#hit(hit: SearchHit, sections: readonly SectionView[]) {
		const section = sections.find((s) => s.id === hit.sectionId);
		const before = hit.snippet.slice(0, hit.start);
		const match = hit.snippet.slice(hit.start, hit.end);
		const after = hit.snippet.slice(hit.end);
		return html`<li>
			<button
				class="hit"
				style=${`--tab:${section?.color ?? 'transparent'}`}
				@click=${() => this.fire('nb-open-hit', { pageId: hit.pageId, sectionId: hit.sectionId })}
			>
				<span class="hit-title">${hit.pageTitle || this.t('page.untitled')}</span>
				<span class="hit-snippet">${before}<mark>${match}</mark>${after}</span>
				<span class="hit-where"
					>${hit.where === 'title' ? this.t('nav.inTitle') : (section?.name ?? '')}</span
				>
			</button>
		</li>`;
	}

	protected override render() {
		const s = this.state;
		if (!s) return nothing;
		const query = s.searchQuery;
		return html`<nav aria-label=${this.t('nav.label')}>
			${
				this.editing?.kind === 'notebook' && s.notebook
					? html`<div class="switch editing">
							${this.#label('notebook', s.notebook.id, s.notebook.name, '')}
						</div>`
					: html`<button
							class="switch"
							style=${`--tab:${s.notebook?.color ?? 'transparent'}`}
							aria-haspopup="menu"
							title=${this.t('nav.switch')}
							@click=${(e: MouseEvent) => {
								const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
								this.fire('nb-notebook-menu', { x: r.left, y: r.bottom });
							}}
						>
							<span class="book" aria-hidden="true">${glyph('notebook-notebook')}</span>
							<span class="label">${s.notebook?.name ?? ''}</span>
							${glyph('chevronDown')}
						</button>`
			}
			<office-ui-search
				class="search"
				.value=${query}
				placeholder=${this.t('nav.search')}
				aria-label=${this.t('nav.search')}
				@input=${(e: Event) => this.fire('nb-search', { query: (e.target as HTMLInputElement).value })}
			></office-ui-search>
			${query ? this.#results(s) : this.#tree(s)}
		</nav>`;
	}

	#results(s: NotebookState) {
		const hits = s.searchResults;
		return html`<section class="results" aria-label=${this.t('search.title')}>
			<p class="count" role="status">
				${hits.length ? this.tn('nav.results', hits.length) : this.t('nav.noResults', { query: s.searchQuery })}
			</p>
			<ul>
				${hits.map((hit) => this.#hit(hit, s.sections))}
			</ul>
		</section>`;
	}

	#tree(s: NotebookState) {
		return html`<div class="columns">
			<section class="sections" aria-label=${this.t('nav.sections')}>
				<ul role="tree" aria-label=${this.t('nav.sections')}>
					${this.#visibleSections(s.sections).map((x) => this.#section(x, s.sectionId))}
				</ul>
				${s.sections.length ? nothing : html`<p class="empty">${this.t('nav.noSections')}</p>`}
				<button class="add" @click=${() => this.fire('nb-add-section', {})}>
					${glyph('plus')}<span>${this.t('nav.addSection')}</span>
				</button>
			</section>
			<section class="pages" aria-label=${this.t('nav.pages')}>
				<button class="add" ?disabled=${!s.section} @click=${() => this.fire('nb-add-page', {})}>
					${glyph('plus')}<span>${this.t('nav.addPage')}</span>
				</button>
				<ul role="listbox" aria-label=${this.t('nav.pages')}>
					${s.pages.map((p) => this.#page(p, s.pageId))}
				</ul>
				${s.section && !s.pages.length ? html`<p class="empty">${this.t('nav.noPages')}</p>` : nothing}
			</section>
		</div>`;
	}
}

export const defineNotebookNav = definer('notebook-nav', () => NotebookNav);
