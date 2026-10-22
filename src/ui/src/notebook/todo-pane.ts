// <notebook-todos>: every to-do tag in the notebook, grouped by section and page. Ticking a box
// ticks the tag in the page's text (for everyone in the notebook); the text opens the page.
import { html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import type { NotebookState, TodoItem } from 'ooxml-core/notebook';
import { controlStyles } from '../base';
import { definer } from '../registry';
import { NotebookElement } from './base';
import css from './todo-pane.css?raw';

export class NotebookTodos extends NotebookElement {
	static override styles = controlStyles(css);
	static override properties = {
		state: { attribute: false },
		hideDone: { state: true },
	};
	declare state: NotebookState | null;
	declare hideDone: boolean;

	constructor() {
		super();
		this.state = null;
		this.hideDone = false;
	}

	#item(item: TodoItem) {
		return html`<li class=${item.done ? 'done' : ''}>
			<input
				type="checkbox"
				.checked=${live(item.done)}
				aria-label=${item.text || this.t('page.untitled')}
				@change=${(e: Event) => this.fire('nb-todo', { item, done: (e.target as HTMLInputElement).checked })}
			/>
			<button
				class="text"
				@click=${() => this.fire('nb-open-todo', { pageId: item.pageId, sectionId: item.sectionId })}
			>
				${item.text}
			</button>
		</li>`;
	}

	protected override render() {
		const s = this.state;
		const todos = (s?.todos ?? []).filter((t) => !this.hideDone || !t.done);
		const open = (s?.todos ?? []).filter((t) => !t.done).length;
		const groups = new Map<string, TodoItem[]>();
		for (const t of todos) groups.set(t.pageId, [...(groups.get(t.pageId) ?? []), t]);
		return html`<aside aria-label=${this.t('todos.title')}>
			<header>
				<h2>${this.t('todos.title')}</h2>
				<span class="count">${this.tn('todos.open', open)}</span>
				<office-ui-button
					command="close-pane"
					size="small"
					icon="close"
					icon-only
					label=${this.t('pane.close')}
					@office-command=${() => this.fire('nb-close-pane', {})}
				></office-ui-button>
			</header>
			<label class="filter"
				><input
					type="checkbox"
					.checked=${this.hideDone}
					@change=${(e: Event) => (this.hideDone = (e.target as HTMLInputElement).checked)}
				/>${this.t('todos.hideDone')}</label
			>
			${(s?.todos.length ?? 0) === 0 ? html`<p class="empty">${this.t('todos.empty')}</p>` : nothing}
			${[...groups.values()].map((items) => {
				const first = items[0]!;
				const section = s?.sections.find((x) => x.id === first.sectionId);
				return html`<section style=${`--tab:${section?.color ?? 'transparent'}`}>
					<h3>
						<span class="section">${section?.name ?? ''}</span
						><span class="page">${first.pageTitle || this.t('page.untitled')}</span>
					</h3>
					<ul>
						${items.map((item) => this.#item(item))}
					</ul>
				</section>`;
			})}
		</aside>`;
	}
}

export const defineNotebookTodos = definer('notebook-todos', () => NotebookTodos);
