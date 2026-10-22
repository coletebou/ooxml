// The pictures a draft's HTML shows by `cid:` in the compose editor: the inline parts of a forward
// or of a draft reopened to edit. A page cannot load a `cid:` URL, so in the editor each picture
// names its part in a data attribute instead, and shows the part's bytes from a URL the page can
// load once they are in (`object-urls.ts`, as the reading pane does). Reading the editor turns each
// back into its `cid:` URL, while its bytes are still coming, once it shows and when they could not
// be read, so the draft's HTML refers to its parts and never to a URL of this page; a picture of a
// part the draft no longer has refers to nothing. What the person deletes from the text is simply
// gone from it, its part still listed with the files. New code.
import type { DraftAttachment } from 'ooxml-core/mail';
import { imageUrl } from './object-urls';

/** Reads the bytes of a part of the draft; null when it cannot. */
export type DownloadPart = (part: DraftAttachment) => Promise<Uint8Array | null>;

/** Each attribute a picture loads from, and the data attribute naming the part it shows there. */
const MARKS = [
	['src', 'data-cid-src'],
	['background', 'data-cid-background'],
] as const;
/** The elements that can show a picture of a part. */
const PICTURES = '[src],[background],[style],[data-cid-src],[data-cid-background]';
/** The characters a `cid:` URL holds as they are; any other is percent-encoded (RFC 2392). */
const ESCAPED = /[^\w!$&'()*+,;=:@./~-]+/g;
const NONE: ReadonlySet<string> = new Set();

/** The `cid:` URL of a Content-ID, written as it is but for what a URL cannot hold. */
function cidUrl(cid: string): string {
	const escape = (text: string): string =>
		[...new TextEncoder().encode(text)]
			.map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
			.join('');
	return `cid:${cid.replace(ESCAPED, escape)}`;
}

/** The parts that have a Content-ID, by it in lower case (the first one of each). */
function byCid(parts: readonly DraftAttachment[]): Map<string, DraftAttachment> {
	const out = new Map<string, DraftAttachment>();
	for (const part of parts) {
		const key = part.cid?.toLowerCase();
		if (key && !out.has(key)) out.set(key, part);
	}
	return out;
}

/** For the sanitiser: each part's `cid:` URL by its Content-ID in lower case, so references stay. */
export function cidUrlsOf(parts: readonly DraftAttachment[]): ReadonlyMap<string, string> {
	return new Map(
		[...byCid(parts)].map(([key, part]): [string, string] => [key, cidUrl(part.cid!)]),
	);
}

const isImage = (part: DraftAttachment): boolean => part.type.toLowerCase().startsWith('image/');

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
	a.size === b.size && [...a].every((item) => b.has(item));

/**
 * The files of a draft to list: every part but the inline pictures the editor shows (`shown`, by
 * Content-ID in lower case), as the reading pane lists a message's. A part attached as a file stays
 * a file even when the text shows it too.
 */
export function listedFiles(
	parts: readonly DraftAttachment[],
	shown: ReadonlySet<string>,
): DraftAttachment[] {
	return parts.filter(
		(part) => !part.inline || !part.cid || !isImage(part) || !shown.has(part.cid.toLowerCase()),
	);
}

export class DraftPictures {
	/** The parts of the draft the window shows. */
	parts: readonly DraftAttachment[] = [];
	/** The parts (Content-IDs in lower case) the editor last showed, replaced when they change. */
	shown: ReadonlySet<string> = NONE;
	/** The URL each picture shows from once its bytes are in, by Content-ID (lower case). */
	private readonly urls = new Map<string, string>();
	/** Every URL a picture of this draft showed from, let go or not, to its Content-ID as written. */
	private readonly made = new Map<string, string>();
	/** The pictures whose bytes were asked for since they were last let go. */
	private readonly asked = new Set<string>();
	/** How often the pictures were let go: bytes asked for before then are dropped. */
	private round = 0;
	private inert: Document | null = null;

	/**
	 * `download` is what reads a part now (none: nothing shows), `editor` the editor the pictures are
	 * in, and `changed` hears that the parts it shows changed (`shown`).
	 */
	constructor(
		private readonly download: () => DownloadPart | null,
		private readonly editor: () => Element | null,
		private readonly changed: () => void,
	) {}

	/** For the sanitiser: each part's `cid:` URL by its Content-ID, so the references stay. */
	get cidUrls(): ReadonlyMap<string, string> {
		return cidUrlsOf(this.parts);
	}

	/** Whether there is anything to keep: a part to refer to, or a URL a picture showed from. */
	private get holding(): boolean {
		return this.made.size > 0 || this.parts.some((part) => part.cid);
	}

	/** A new draft: the pictures of the last one are let go and their URLs forgotten. */
	start(parts: readonly DraftAttachment[]): void {
		this.release();
		this.made.clear();
		this.parts = parts;
		this.shown = NONE;
	}

	/** Let the pictures go, revoking their object URLs; the next `mark` asks for them again. */
	release(): void {
		this.round++;
		for (const url of this.urls.values()) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
		this.urls.clear();
		this.asked.clear();
	}

	/**
	 * Show the pictures the editor holds: each `cid:` URL of a part the sanitiser left (`cidUrls`)
	 * becomes a marked picture, which shows from its URL once its bytes are in (asked for here) and
	 * from nothing until then, rather than as a broken one.
	 */
	mark(): void {
		const root = this.editor();
		if (!root) return;
		const known = byCid(this.parts);
		const cids = new Map(
			[...known].map(([key, part]): [string, string] => [cidUrl(part.cid!), key]),
		);
		const shown = new Set<string>();
		for (const el of known.size ? root.querySelectorAll(PICTURES) : []) {
			for (const [name, mark] of MARKS) {
				const value = el.getAttribute(name);
				const key =
					el.getAttribute(mark) ??
					(value === null ? undefined : (cids.get(value) ?? this.made.get(value)?.toLowerCase()));
				if (key === undefined || !known.has(key)) continue;
				el.setAttribute(mark, key);
				shown.add(key);
				const url = this.urls.get(key);
				if (url && value !== url) el.setAttribute(name, url);
				else if (!url && value !== null && cids.has(value)) el.removeAttribute(name);
			}
			this.restyle(el, known, shown, (key, cid) => this.urls.get(key) ?? cid);
		}
		this.setShown(shown);
		const download = this.download();
		if (download) for (const key of shown) this.ask(download, known.get(key)!);
	}

	/** What `root` holds as the draft's HTML: each picture of a part as its `cid:` URL. */
	read(root: Element): string {
		if (!this.holding) {
			this.setShown(NONE);
			return root.innerHTML;
		}
		const copy = this.inertDocument().importNode(root, true);
		this.setShown(this.unmark(copy));
		return copy.innerHTML;
	}

	/** `markup` (HTML pasted or dropped) with the pictures of the draft it holds as `cid:` URLs. */
	refer(markup: string): string {
		if (!this.holding) return markup;
		// Parsed where nothing loads or runs; what comes out still goes through the sanitiser.
		const box = this.inertDocument().createElement('div');
		box.innerHTML = markup;
		this.unmark(box);
		return box.innerHTML;
	}

	/** Turn each picture of a part in `root` into its `cid:` URL; the parts it shows. */
	private unmark(root: Element): Set<string> {
		const known = byCid(this.parts);
		const shown = new Set<string>();
		for (const el of root.querySelectorAll(PICTURES)) {
			for (const [name, mark] of MARKS) {
				const value = el.getAttribute(name);
				const key =
					el.getAttribute(mark) ??
					(value === null ? undefined : this.made.get(value)?.toLowerCase());
				el.removeAttribute(mark);
				const part = key === undefined ? undefined : known.get(key);
				if (part) {
					el.setAttribute(name, cidUrl(part.cid!));
					shown.add(key!);
				} else if (value !== null && this.made.has(value)) el.removeAttribute(name);
			}
			this.restyle(el, known, shown, (_key, cid) => cid);
		}
		return shown;
	}

	/**
	 * Point what the style of `el` loads from a part (its `cid:` URL, or a URL it showed from) at
	 * `target(key, cid URL)`, adding the parts it shows to `shown`. A URL it showed from that is of
	 * no part of the draft any more goes back to its `cid:` URL, which refers to nothing.
	 */
	private restyle(
		el: Element,
		known: ReadonlyMap<string, DraftAttachment>,
		shown: Set<string>,
		target: (key: string, cid: string) => string,
	): void {
		const style = el.getAttribute('style');
		if (!style?.includes('"')) return;
		const sources: [string, string][] = [
			...[...known.values()].map((part): [string, string] => [cidUrl(part.cid!), part.cid!]),
			...this.made,
		];
		let next = style;
		for (const [from, cid] of sources) {
			const quoted = `"${from}"`;
			if (!next.includes(quoted)) continue;
			const key = cid.toLowerCase();
			const shows = known.has(key);
			if (shows) shown.add(key);
			// Split and joined, not replaced: a Content-ID may hold `$'`, a replacement pattern.
			next = next.split(quoted).join(`"${shows ? target(key, cidUrl(cid)) : cidUrl(cid)}"`);
		}
		if (next !== style) el.setAttribute('style', next);
	}

	/** Ask for the bytes of `part` unless they are in or on their way, or it is no picture. */
	private ask(download: DownloadPart, part: DraftAttachment): void {
		const key = part.cid!.toLowerCase();
		if (this.asked.has(key) || this.urls.has(key) || !isImage(part)) return;
		this.asked.add(key);
		const round = this.round;
		void Promise.resolve()
			.then(() => download(part))
			// A picture whose bytes cannot be read keeps its reference and shows nothing.
			.catch(() => null)
			.then((bytes) => {
				if (!bytes || round !== this.round) return;
				const url = imageUrl(bytes, part.type);
				this.urls.set(key, url);
				this.made.set(url, part.cid!);
				this.mark();
			});
	}

	private setShown(shown: ReadonlySet<string>): void {
		if (sameSet(shown, this.shown)) return;
		this.shown = shown;
		this.changed();
	}

	/** A document of its own, where parsed HTML loads nothing and runs nothing. */
	private inertDocument(): Document {
		this.inert ??= document.implementation.createHTMLDocument('');
		return this.inert;
	}
}
