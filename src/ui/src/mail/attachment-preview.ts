// <mail-attachment-preview>: an attachment opened in place. Word, Excel and Visio files load in the
// suite's own viewers (read-only), presentations in the shared reading surface, images and text as
// they are; each viewer's code loads only when a file of its kind is opened. It is a modal dialog
// (modal.ts): the focus moves in when it opens and back when it closes or is removed.
import { html, nothing, type PropertyValues } from 'lit';
import { keyed } from 'lit/directives/keyed.js';
import { previewKind, type PreviewKind } from './attachments';
import { defineOnce, MailElement, mailStyles } from './base';
import { icon } from './icons';
import type { OpenAttachmentDetail } from './mail-app';
import { FocusReturn, focusFirst, trapKeys } from './modal';
import css from './attachment-preview.css?raw';

type Viewer = HTMLElement & { load(bytes: Uint8Array, name?: string): Promise<void> };

export class MailAttachmentPreview extends MailElement {
	static override styles = mailStyles(css);
	static override properties = {
		...MailElement.properties,
		detail: { attribute: false },
		status: { state: true },
		text: { state: true },
		url: { state: true },
	};
	declare detail: OpenAttachmentDetail | null;
	declare status: 'loading' | 'ready' | 'error';
	declare text: string;
	declare url: string;
	private generation = 0;
	private readonly focusReturn = new FocusReturn();

	constructor() {
		super();
		this.detail = null;
		this.status = 'loading';
		this.text = '';
		this.url = '';
	}

	protected override updated(changed: PropertyValues<this>): void {
		if (!changed.has('detail')) return;
		const previous = changed.get('detail');
		if (this.detail && !previous) {
			this.focusReturn.take(this.ownerDocument);
			focusFirst(this.renderRoot);
		} else if (!this.detail && previous) this.focusReturn.restore();
		void this.load();
	}

	override disconnectedCallback(): void {
		this.generation++;
		this.revoke();
		super.disconnectedCallback();
		// Removed while open (the app closes it that way): the focus goes back once it is gone.
		if (this.detail)
			queueMicrotask(() => {
				if (!this.isConnected) this.focusReturn.restore();
			});
	}

	private revoke(): void {
		if (this.url) URL.revokeObjectURL(this.url);
		this.url = '';
	}

	private get kind(): PreviewKind {
		return this.detail ? previewKind(this.detail.attachment) : null;
	}

	private async load(): Promise<void> {
		const generation = ++this.generation;
		this.revoke();
		this.text = '';
		this.status = 'loading';
		const detail = this.detail;
		const kind = this.kind;
		if (!detail || !kind) {
			this.status = 'error';
			return;
		}
		try {
			if (kind === 'image') {
				this.url = URL.createObjectURL(
					new Blob([new Uint8Array(detail.bytes)], { type: detail.attachment.type }),
				);
			} else if (kind === 'text') {
				this.text = new TextDecoder().decode(detail.bytes.subarray(0, 2_097_152));
			} else {
				if (kind === 'docx') (await import('../docx/index')).registerDocxEditor();
				if (kind === 'xlsx') (await import('../xlsx/index')).defineXlsxEditor();
				if (kind === 'vsdx') (await import('../visio/index')).registerVisioViewer();
				if (kind === 'pptx')
					(await import('../preview/presentation-preview')).definePresentationPreview(
						'mail-presentation-preview',
					);
				if (generation !== this.generation) return;
				await this.updateComplete;
				const viewer = this.renderRoot.querySelector<Viewer>(
					'docx-editor, xlsx-editor, visio-viewer, mail-presentation-preview',
				);
				if (!viewer) throw new Error('viewer not mounted');
				await viewer.load(detail.bytes, detail.attachment.name);
			}
			if (generation === this.generation) this.status = 'ready';
		} catch {
			if (generation === this.generation) this.status = 'error';
		}
	}

	private viewer() {
		const detail = this.detail!;
		switch (this.kind) {
			case 'docx':
				return html`<docx-editor
					.readOnly=${true}
					.locale=${this.i18n.locale}
					.fileName=${detail.attachment.name}
				></docx-editor>`;
			case 'xlsx':
				return html`<xlsx-editor
					.readOnly=${true}
					.locale=${this.i18n.locale}
					.fileName=${detail.attachment.name}
				></xlsx-editor>`;
			case 'vsdx':
				return html`<visio-viewer .showToolbar=${false} locale=${this.i18n.locale}></visio-viewer>`;
			case 'pptx':
				return html`<mail-presentation-preview
					.locale=${this.i18n.locale}
				></mail-presentation-preview>`;
			case 'image':
				return this.url ? html`<img src=${this.url} alt=${detail.attachment.name} />` : nothing;
			case 'text':
				return html`<pre>${this.text}</pre>`;
			default:
				return nothing;
		}
	}

	protected override render() {
		const detail = this.detail;
		if (!detail) return nothing;
		return html`<section
			class="preview"
			role="dialog"
			aria-modal="true"
			aria-label=${this.t('preview.title', { name: detail.attachment.name })}
			@keydown=${(e: KeyboardEvent) => trapKeys(e, () => this.emit('mail-preview-close', {}))}
		>
			<header>
				<h2>${detail.attachment.name}</h2>
				<button type="button" @click=${() => this.emit('mail-preview-download', detail)}
					>${icon('mail-download')}<span>${this.t('reading.download')}</span></button
				>
				<button
					type="button"
					class="close"
					aria-label=${this.t('preview.close')}
					title=${this.t('preview.close')}
					@click=${() => this.emit('mail-preview-close', {})}
					>${icon('close')}</button
				>
			</header>
			${this.kind && this.kind !== 'image' && this.kind !== 'text' ? html`<p class="hint">${this.t('preview.readOnly')}</p>` : nothing}
			${this.status === 'loading' ? html`<p class="hint" role="status">${this.t('preview.loading')}</p>` : nothing}
			${this.status === 'error' ? html`<p class="error" role="alert">${this.t('preview.failed')}</p>` : nothing}
			<div class="stage">${keyed(detail, this.viewer())}</div>
		</section>`;
	}
}

export function defineMailAttachmentPreview(): void {
	defineOnce('mail-attachment-preview', MailAttachmentPreview);
}
