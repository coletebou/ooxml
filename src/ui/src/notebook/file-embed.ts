// <notebook-file>: an embedded file on a page. Word, Excel, Visio and PowerPoint files are shown
// live, read-only, by the suite's own viewers (loaded on demand, as the team workspace does: the
// editors are large); any other file is a card. Open and Download are events the page turns into
// the host's `notebook-open-file` (which defaults to a download).
import { html, nothing } from 'lit';
import { keyed } from 'lit/directives/keyed.js';
import type { FileContainer } from 'ooxml-core/notebook';
import { glyph } from '../glyph';
import { controlStyles } from '../base';
import { definer } from '../registry';
import { NotebookElement } from './base';
import { formatSize } from './i18n/translator';
import css from './file-embed.css?raw';

type Viewer = HTMLElement & { load(bytes: Uint8Array, name?: string): Promise<void> };
const LIVE = new Set(['docx', 'xlsx', 'pptx', 'vsdx']);

async function defineViewer(kind: string): Promise<void> {
	if (kind === 'docx') (await import('../docx/index')).registerDocxEditor();
	if (kind === 'xlsx') (await import('../xlsx/index')).defineXlsxEditor();
	if (kind === 'vsdx') (await import('../visio/index')).registerVisioViewer();
	if (kind === 'pptx')
		(await import('../teams/app/presentation-preview')).defineTeamsPresentationPreview();
}

export class NotebookFile extends NotebookElement {
	static override styles = controlStyles(css);
	static override properties = {
		container: { attribute: false },
		bytes: { attribute: false },
		status: { state: true },
	};
	declare container: FileContainer | null;
	declare bytes: Uint8Array | null;
	declare status: 'idle' | 'loading' | 'ready' | 'error';
	#loaded: Uint8Array | null = null;
	#generation = 0;

	constructor() {
		super();
		this.container = null;
		this.bytes = null;
		this.status = 'idle';
	}

	protected override updated(changed: Map<string, unknown>): void {
		if ((changed.has('bytes') || changed.has('container')) && this.bytes !== this.#loaded)
			void this.#load();
	}

	async #load(): Promise<void> {
		const container = this.container;
		const bytes = this.bytes;
		this.#loaded = bytes;
		const generation = ++this.#generation;
		if (!container || !bytes || !LIVE.has(container.office)) return;
		this.status = 'loading';
		try {
			await defineViewer(container.office);
			if (generation !== this.#generation) return;
			this.status = 'ready';
			await this.updateComplete;
			const viewer = this.renderRoot.querySelector<Viewer>('.viewer');
			if (!viewer) throw new Error('viewer not mounted');
			await viewer.load(bytes.slice(), container.name);
		} catch {
			if (generation === this.#generation) this.status = 'error';
		}
	}

	#viewer() {
		const c = this.container!;
		const locale = this.i18n.locale;
		if (c.office === 'docx')
			return html`<docx-editor
				class="viewer"
				.readOnly=${true}
				.showToolbar=${false}
				.locale=${locale}
				.fileName=${c.name}
			></docx-editor>`;
		if (c.office === 'xlsx')
			return html`<xlsx-editor
				class="viewer"
				.readOnly=${true}
				.showToolbar=${false}
				.locale=${locale}
				.fileName=${c.name}
			></xlsx-editor>`;
		if (c.office === 'vsdx')
			return html`<visio-viewer
				class="viewer"
				.showToolbar=${false}
				locale=${locale}
			></visio-viewer>`;
		return html`<teams-presentation-preview
			class="viewer"
			.locale=${locale}
		></teams-presentation-preview>`;
	}

	protected override render() {
		const c = this.container;
		if (!c) return nothing;
		const live = LIVE.has(c.office);
		const kind = this.t(`embed.kind.${live ? c.office : 'file'}` as 'embed.kind.file');
		return html`<header class="bar">
				<span class="badge" data-kind=${live ? c.office : 'other'}>${glyph('notebook-file')}</span>
				<span class="name" title=${c.name}>${c.name}</span>
				<span class="meta">${kind} · ${formatSize(c.size, this.i18n)}</span>
				<office-ui-button
					command="embed-open"
					size="small"
					icon="share"
					label=${this.t('embed.open')}
					@office-command=${(e: Event) => (e.stopPropagation(), this.fire('nb-file-open', { id: c.id }))}
				></office-ui-button>
				<office-ui-button
					command="embed-download"
					size="small"
					icon="notebook-download"
					label=${this.t('embed.download')}
					@office-command=${(e: Event) => (e.stopPropagation(), this.fire('nb-file-download', { id: c.id }))}
				></office-ui-button>
			</header>
			${
				live
					? html`<div
							class="body"
							aria-label=${this.t('embed.preview', { name: c.name })}
							role="region"
						>
							${this.status === 'loading' ? html`<p class="status">${this.t('embed.loading', { name: c.name })}</p>` : nothing}
							${this.status === 'error' ? html`<p class="status" role="alert">${this.t('embed.failed')}</p>` : nothing}
							${this.status === 'ready' ? keyed(this.#loaded, this.#viewer()) : nothing}
						</div>`
					: nothing
			}`;
	}
}

export const defineNotebookFile = definer('notebook-file', () => NotebookFile);
