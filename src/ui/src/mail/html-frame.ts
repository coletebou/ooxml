// <mail-html-frame>: one message's HTML body, sanitised (sanitize.ts, part by part when it was
// sent in several) and shown in a sandboxed frame: no scripts (`allow-scripts` is never granted),
// no forms, no top navigation, and a Content-Security-Policy that blocks remote loads until
// `allowRemote`. The frame is same-origin only so the host can size it to its content, route
// `mailto:` links (an image map's areas too) to compose, and hear the keys pressed in it: a key
// stays in the frame's document, so each one the message does not act on itself goes on as a
// `keydown` of the element, where the app's shortcuts hear it. New code.
import { html, type PropertyValues } from 'lit';
import { OFFICE_TOKENS, type OfficeToken } from '../tokens';
import { defineOnce, MailElement, mailStyles } from './base';
import { emailDocument, sanitizeMessageHtml, type FrameStyle } from './sanitize';
import css from './html-frame.css?raw';

const SANDBOX = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox';

/**
 * The keys a message's document acts on itself, with any modifier: the arrows, Space, Page Up and
 * Down, Home and End scroll it, Tab moves the focus through its links, and Enter follows one or
 * opens a `<details>`. Ctrl/Cmd+A, which selects its text, is its own too; Ctrl/Cmd+Enter (send)
 * is not.
 */
const DOCUMENT_KEYS = new Set([
	' ',
	'Enter',
	'Tab',
	'ArrowUp',
	'ArrowDown',
	'ArrowLeft',
	'ArrowRight',
	'Home',
	'End',
	'PageUp',
	'PageDown',
]);

function documentOwns(event: KeyboardEvent): boolean {
	const chord = event.ctrlKey || event.metaKey;
	if (chord && event.key === 'Enter') return false;
	return DOCUMENT_KEYS.has(event.key) || (chord && event.key.toLowerCase() === 'a');
}

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
		// The empty document a frame loads as it is put in the page is not the message: measured
		// before the message's own replaces it, it would have the frame take its height for a moment.
		if (!frame || !doc || !frame.srcdoc) return;
		// The frame is as tall as its message. The content runs no script, so its height changes when
		// an image or a web font loads, when a `<details>` is opened or closed, and when the frame's
		// width changes (the text reflows); a style that changes it by itself (an animation, `:hover`)
		// is not followed. The frame element is observed, not the body inside it, and the height is
		// written on the next frame and only when it changed, so the observer never sees its own write
		// within one frame (a resize loop). The height is measured apart from the one the frame has
		// (`contentHeight`), so a write of it never makes the next measurement taller.
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
		// A `<details>` shows or hides what it holds; its `toggle` does not bubble, so it is caught on
		// its way down.
		doc.addEventListener('toggle', fit, true);
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
		doc.addEventListener('keydown', (event) => this.handOn(event));
	}

	/** A key pressed in the message, as a `keydown` of the element; one a shortcut takes stays there. */
	private handOn(event: KeyboardEvent): void {
		if (event.defaultPrevented || event.isComposing || documentOwns(event)) return;
		const copy = new KeyboardEvent('keydown', {
			key: event.key,
			code: event.code,
			location: event.location,
			repeat: event.repeat,
			ctrlKey: event.ctrlKey,
			shiftKey: event.shiftKey,
			altKey: event.altKey,
			metaKey: event.metaKey,
			bubbles: true,
			composed: true,
			cancelable: true,
		});
		if (!this.dispatchEvent(copy)) event.preventDefault();
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
