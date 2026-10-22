// The files of <mail-compose>: those a person picks or drops, read for the draft they were added
// to, and the list of those already in it. A read that ends once its window closed, gave way to
// another draft or was discarded hands its files to nobody, and the window's own hand-overs wait
// for the reads still running (`settled`). A file the browser cannot read is left out and named,
// the others still attached. New code.
import { html, nothing } from 'lit';
import type { DraftAttachment, FileInput } from 'ooxml-core/mail';
import { readFiles } from './picked-files';
import { fileSize } from './format';
import type { MailI18n } from './i18n/translator';
import { icon } from './icons';

export class FileReads {
	private readonly running = new Set<Promise<void>>();
	/** The session whose draft was thrown away: the files still being read for it go nowhere. */
	private discarded: number | null = null;

	/**
	 * `session` is the compose session the window shows now; `deliver` gets the files of a read once
	 * they are in, with the session they were read for; `unreadable` gets the names of the files of
	 * that read the browser refused; `changed` hears how many reads are running.
	 */
	constructor(
		private readonly session: () => number | undefined,
		private readonly deliver: (files: FileInput[], session: number) => void,
		private readonly unreadable: (names: string[]) => void,
		private readonly changed: (running: number) => void,
	) {}

	/** Read `list` for the draft the window shows now. Never rejects. */
	read(list: FileList | null | undefined): Promise<void> {
		const session = this.session();
		if (!list?.length || session === undefined) return Promise.resolve();
		const read = readFiles(list)
			.then(({ read: files, unreadable }) => {
				if (this.session() !== session || this.discarded === session) return;
				if (files.length) this.deliver(files, session);
				if (unreadable.length) this.unreadable(unreadable);
			})
			.finally(() => {
				this.running.delete(read);
				this.changed(this.running.size);
			});
		this.running.add(read);
		this.changed(this.running.size);
		return read;
	}

	/** The draft of `session` is thrown away: what is still being read for it is dropped. */
	discard(session: number): void {
		this.discarded = session;
	}

	/** Resolves once no read is running, those started meanwhile included. */
	async settled(): Promise<void> {
		while (this.running.size) await Promise.allSettled([...this.running]);
	}
}

/** The files in the draft, each with its size and a button that takes it out (`detach`). */
export function fileList(
	attachments: readonly DraftAttachment[],
	i18n: MailI18n,
	detach: (blobId: string) => void,
) {
	if (!attachments.length) return nothing;
	return html`<ul class="files"
		>${attachments.map(
			(a) =>
				html`<li
					>${icon('mail-attach')}<span>${a.name}</span><small>${fileSize(a.size, i18n)}</small>
					<button
						type="button"
						class="icon-button"
						aria-label=${i18n.t('compose.removeFile', { name: a.name })}
						@click=${() => detach(a.blobId)}
						>${icon('close')}</button
					></li
				>`,
		)}</ul
	>`;
}
