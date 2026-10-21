// <mail-html-frame>: one message's HTML body, sanitised (sanitize.ts, part by part when it was
// sent in several) and shown in a sandboxed frame: no scripts (`allow-scripts` is never granted),
// no forms, no top navigation, and a Content-Security-Policy that blocks remote loads until
// `allowRemote`. The frame is same-origin only so the host can size it to its content and route
// `mailto:` links (an image map's areas too) to compose. New code.
import { html, type PropertyValues } from 'lit';
import { OFFICE_TOKENS, type OfficeToken } from '../tokens';
import { defineOnce, MailElement, mailStyles } from './base';
import { emailDocument, sanitizeMessageHtml, type FrameStyle } from './sanitize';
import css from './html-frame.css?raw';

const SANDBOX = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox';

export class MailHtmlFrame extends MailElement {
	static override styles = mailStyles(css);
	static override properties = {
		...MailElement.properties,
		html: { attribute: false },
		htmlParts: { attribute: false },
		allowRemote: { type: Boolean, attribute: 'allow-remote' },
		cidUrls: { attribute: false },
		label: { type: String },
	};
	/** The message's HTML as sent: untrusted. */
	declare html: string;
	/**
	 * The parts `html` was sent in, when there were several (`MailMessage.htmlParts`): untrusted.
	 * Each is sanitised on its own, so one that ends in an open comment or tag cannot take in the
	 * rest, and `html` is then not read.
	 */
	declare htmlParts: readonly string[] | null;
	declare allowRemote: boolean;
	declare cidUrls: ReadonlyMap<string, string>;
	declare label: string;
	private resize: ResizeObserver | undefined;

	constructor() {
		super();
		this.html = '';
		this.htmlParts = null;
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
		const inputs = ['html', 'htmlParts', 'allowRemote', 'cidUrls'] as const;
		if (!inputs.some((name) => changed.has(name))) return;
		const content = sanitizeMessageHtml(
			{ html: this.html, htmlParts: this.htmlParts },
			{ allowRemote: this.allowRemote, cidUrls: this.cidUrls },
		);
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
		// when an image or a web font loads or the frame's width changes (the text reflows): the frame
		// element is observed, not the body inside it, and the height is written on the next frame and
		// only when it changed, so the observer never sees its own write within one frame (a resize
		// loop). The height is measured apart from the one the frame has (`contentHeight`), so a write
		// of it never makes the next measurement taller.
		let pending = 0;
		const fit = (): void => {
			cancelAnimationFrame(pending);
			pending = requestAnimationFrame(() => {
				const height = `${this.contentHeight(frame, doc)}px`;
				if (height !== '0px' && frame.style.height !== height) frame.style.height = height;
			});
		};
		fit();
		for (const image of doc.images) image.addEventListener('load', fit, { once: true });
		// A web font the first layout asks for holds the load back, but one the text asks for only
		// later (a style for another width) arrives after it and sets the text again. A document
		// another message has replaced by then is not measured (`contentHeight`).
		doc.fonts?.addEventListener('loadingdone', fit);
		this.resize?.disconnect();
		if (typeof ResizeObserver !== 'undefined') {
			this.resize = new ResizeObserver(fit);
			this.resize.observe(frame);
		}
		doc.addEventListener('click', (event) => {
			// A link, or an area of an image map: a click follows the `href` of either.
			const link = (event.target as Element | null)?.closest?.('a[href], area[href]');
			const href = link?.getAttribute('href') ?? '';
			if (!/^mailto:/i.test(href)) return;
			event.preventDefault();
			this.emit('mail-mailto', { href });
		});
	}

	/**
	 * The height `doc` takes, read with `frame` at its smallest: a document is never shorter than its
	 * frame, so read at the frame's own height a shorter message that replaces a longer one, or text
	 * a wider frame puts on fewer lines, would keep the old height, and content as tall as its window
	 * (`100vh`) would grow with every height written. The element keeps the frame's space meanwhile,
	 * so nothing around it moves or scrolls. 0 once another message has replaced `doc`.
	 */
	private contentHeight(frame: HTMLIFrameElement, doc: Document): number {
		if (frame.contentDocument !== doc || !doc.documentElement) return 0;
		const { minHeight } = this.style;
		const { height } = frame.style;
		this.style.minHeight = `${this.offsetHeight}px`;
		frame.style.height = '0px';
		const content = doc.documentElement.scrollHeight;
		frame.style.height = height;
		this.style.minHeight = minHeight;
		return content;
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
