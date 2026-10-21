// <mail-html-frame>: one message's HTML body, sanitised (sanitize.ts) and shown in a sandboxed
// frame: no scripts (`allow-scripts` is never granted), no forms, no top navigation, and a
// Content-Security-Policy that blocks remote loads until `allowRemote`. The frame is same-origin
// only so the host can size it to its content and route `mailto:` links to compose. New code.
import { html, type PropertyValues } from 'lit';
import { OFFICE_TOKENS, type OfficeToken } from '../tokens';
import { defineOnce, MailElement, mailStyles } from './base';
import { emailDocument, sanitizeEmailHtml, type FrameStyle } from './sanitize';
import css from './html-frame.css?raw';

const SANDBOX = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox';

export class MailHtmlFrame extends MailElement {
	static override styles = mailStyles(css);
	static override properties = {
		...MailElement.properties,
		html: { attribute: false },
		allowRemote: { type: Boolean, attribute: 'allow-remote' },
		cidUrls: { attribute: false },
		label: { type: String },
	};
	/** The message's HTML as sent: untrusted. */
	declare html: string;
	declare allowRemote: boolean;
	declare cidUrls: ReadonlyMap<string, string>;
	declare label: string;
	private resize: ResizeObserver | undefined;

	constructor() {
		super();
		this.html = '';
		this.allowRemote = false;
		this.cidUrls = new Map();
		this.label = '';
	}

	/** Colours and type for the frame, from the host's tokens (the frame cannot read them). */
	private frameStyle(): FrameStyle {
		const style = getComputedStyle(this);
		const value = (name: OfficeToken): string =>
			style.getPropertyValue(name).trim() || OFFICE_TOKENS[name];
		return {
			font: value('--office-font'),
			fontSize: value('--office-font-size-md'),
			color: value('--office-mail-paper-foreground'),
			background: value('--office-paper'),
			link: value('--office-mail-paper-link'),
			quote: value('--office-mail-paper-quote'),
		};
	}

	private get frame(): HTMLIFrameElement | null {
		return this.renderRoot.querySelector('iframe');
	}

	protected override updated(changed: PropertyValues<this>): void {
		if (!changed.has('html') && !changed.has('allowRemote') && !changed.has('cidUrls')) return;
		const content = sanitizeEmailHtml(this.html, {
			allowRemote: this.allowRemote,
			cidUrls: this.cidUrls,
		});
		this.emit('mail-remote-blocked', { count: content.blocked });
		const frame = this.frame;
		if (frame) frame.srcdoc = emailDocument(content, this.allowRemote, this.frameStyle());
	}

	override disconnectedCallback(): void {
		this.resize?.disconnect();
		super.disconnectedCallback();
	}

	private loaded(): void {
		const frame = this.frame;
		const doc = frame?.contentDocument;
		if (!frame || !doc) return;
		// The frame is as tall as its message. The content runs no script, so it only changes height
		// when an image loads or the frame's width changes (the text reflows): the frame element is
		// observed, not the body inside it, and the height is written on the next frame and only when
		// it changed, so the observer never sees its own write within one frame (a resize loop).
		let pending = 0;
		const fit = (): void => {
			cancelAnimationFrame(pending);
			pending = requestAnimationFrame(() => {
				const height = `${doc.documentElement?.scrollHeight ?? 0}px`;
				if (height !== '0px' && frame.style.height !== height) frame.style.height = height;
			});
		};
		fit();
		for (const image of doc.images) image.addEventListener('load', fit, { once: true });
		this.resize?.disconnect();
		if (typeof ResizeObserver !== 'undefined') {
			this.resize = new ResizeObserver(fit);
			this.resize.observe(frame);
		}
		doc.addEventListener('click', (event) => {
			const link = (event.target as Element | null)?.closest?.('a[href]');
			const href = link?.getAttribute('href') ?? '';
			if (!/^mailto:/i.test(href)) return;
			event.preventDefault();
			this.emit('mail-mailto', { href });
		});
	}

	protected override render() {
		return html`<iframe
			title=${this.label}
			sandbox=${SANDBOX}
			referrerpolicy="no-referrer"
			@load=${() => this.loaded()}
		></iframe>`;
	}
}

export function defineMailHtmlFrame(): void {
	defineOnce('mail-html-frame', MailHtmlFrame);
}
