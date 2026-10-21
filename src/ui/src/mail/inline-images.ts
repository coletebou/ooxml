// The pictures a message's HTML body shows in place (its `cid:` parts), as URLs its frame can load
// (`object-urls.ts`). Only the parts the body shows are downloaded. The pictures of the last few
// messages are kept, so going back to one shows them at once; those of older messages are let go,
// their object URLs revoked, except for the messages still on screen. A picture that could not be
// downloaded (offline) is asked for again the next time its message shows. New code.
import type { MailAttachment, MailMessage } from 'ooxml-core/mail';
import { bodyImages } from './attachments';
import { imageUrl } from './object-urls';

/** How many messages keep their pictures besides those on screen. */
export const KEPT_MESSAGES = 16;

const NONE: ReadonlyMap<string, string> = new Map();

/** What the pictures of a message are made from: its HTML body (part by part) and attachments. */
export type PictureMessage = Pick<MailMessage, 'id' | 'html' | 'htmlParts' | 'attachments'>;

interface Entry {
	/** The parts the pictures are made from, so a message whose parts changed is read again. */
	parts: string;
	urls: Promise<ReadonlyMap<string, string>>;
	/** The object URLs made so far, revoked when the message is let go (a `data:` URL holds nothing). */
	made: string[];
	/** Let go: what is still downloading for it is dropped. */
	gone: boolean;
	/** A picture could not be downloaded: the next look asks for the missing ones again. */
	missing: boolean;
}

export class InlineImages {
	/** By message id, the least recently used first. */
	private readonly entries = new Map<string, Entry>();

	/**
	 * `download` reads a part (null when it cannot); `shown` names the messages on screen, whose
	 * pictures are never let go.
	 */
	constructor(
		private readonly download: (part: MailAttachment) => Promise<Uint8Array | null>,
		private readonly shown: () => ReadonlySet<string>,
	) {}

	/** The URLs of the pictures `message`'s body shows, by `cid` (lower case). */
	urls(message: PictureMessage): Promise<ReadonlyMap<string, string>> {
		const parts = bodyImages(message);
		const key = parts.map((part) => part.blobId).join('\n');
		const known = this.entries.get(message.id);
		// Taken out and put back last: the most recently used message is the last one let go.
		this.entries.delete(message.id);
		if (known && known.parts === key) {
			this.entries.set(message.id, known);
			if (known.missing) {
				// Asked again once the look under way has ended, keeping the pictures it got.
				known.missing = false;
				known.urls = known.urls.then((got) => this.make(known, parts, got));
			}
			return known.urls;
		}
		if (known) this.revoke(known);
		if (!parts.length) return Promise.resolve(NONE);
		const entry: Entry = {
			parts: key,
			urls: Promise.resolve(NONE),
			made: [],
			gone: false,
			missing: false,
		};
		entry.urls = this.make(entry, parts, NONE);
		this.entries.set(message.id, entry);
		this.trim();
		return entry.urls;
	}

	/** Let every picture go: the client changed, or the app went away. */
	clear(): void {
		for (const entry of this.entries.values()) this.revoke(entry);
		this.entries.clear();
	}

	/** The URLs of `parts`: those in `got` already, and the others downloaded now. */
	private async make(
		entry: Entry,
		parts: readonly MailAttachment[],
		got: ReadonlyMap<string, string>,
	): Promise<ReadonlyMap<string, string>> {
		const urls = new Map(got);
		for (const part of parts) {
			const cid = part.cid!.toLowerCase();
			if (urls.has(cid)) continue;
			const bytes = await this.download(part);
			if (entry.gone) break;
			if (!bytes) {
				entry.missing = true;
				continue;
			}
			const url = imageUrl(bytes, part.type);
			if (url.startsWith('blob:')) entry.made.push(url);
			urls.set(cid, url);
		}
		return urls;
	}

	private revoke(entry: Entry): void {
		entry.gone = true;
		for (const url of entry.made) URL.revokeObjectURL(url);
		entry.made = [];
	}

	/** Let the least recently used messages go while too many are kept, never one on screen. */
	private trim(): void {
		if (this.entries.size <= KEPT_MESSAGES) return;
		const shown = this.shown();
		for (const [id, entry] of this.entries) {
			if (this.entries.size <= KEPT_MESSAGES) return;
			if (shown.has(id)) continue;
			this.revoke(entry);
			this.entries.delete(id);
		}
	}
}
