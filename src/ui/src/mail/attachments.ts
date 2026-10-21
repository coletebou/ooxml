// The attachment strip of a message: each file with its kind, size, and Preview (Word, Excel,
// PowerPoint and Visio files through the suite's own viewers, images, text) and Download. Files a
// person picks or drops are read here for the client too.
import { html, nothing } from 'lit';
import type { FileInput, MailAttachment, MailMessage } from 'ooxml-core/mail';
import { fileSize } from './format';
import type { MailI18n } from './i18n/translator';
import { icon } from './icons';
import { sanitizeEmailHtml } from './sanitize';

export type PreviewKind = 'docx' | 'xlsx' | 'pptx' | 'vsdx' | 'image' | 'text' | null;

const OFFICE: Record<string, PreviewKind> = {
	docx: 'docx',
	docm: 'docx',
	dotx: 'docx',
	xlsx: 'xlsx',
	xlsm: 'xlsx',
	xltx: 'xlsx',
	pptx: 'pptx',
	pptm: 'pptx',
	potx: 'pptx',
	ppsx: 'pptx',
	vsdx: 'vsdx',
	vsdm: 'vsdx',
};
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']);

/** Which viewer can show an attachment, from its extension then its type; null when none. */
export function previewKind(attachment: Pick<MailAttachment, 'name' | 'type'>): PreviewKind {
	const ext = attachment.name.split('.').pop()?.toLowerCase() ?? '';
	const office = OFFICE[ext];
	if (office) return office;
	if (IMAGE_TYPES.has(attachment.type)) return 'image';
	if (attachment.type === 'text/plain' || attachment.type === 'text/csv') return 'text';
	return null;
}

/** Picked or dropped files as the client takes them: name, type and bytes. */
export function readFiles(list: FileList | null | undefined): Promise<FileInput[]> {
	return Promise.all(
		[...(list ?? [])].map(async (file) => ({
			name: file.name,
			type: file.type,
			bytes: new Uint8Array(await file.arrayBuffer()),
		})),
	);
}

/** The token colour of a file chip. */
const kindColor = (kind: PreviewKind): string =>
	kind === 'docx' || kind === 'xlsx' || kind === 'pptx' || kind === 'vsdx'
		? `var(--office-file-${kind})`
		: 'var(--office-file-other)';

export interface AttachmentHandlers {
	preview(attachment: MailAttachment): void;
	download(attachment: MailAttachment): void;
}

type StripMessage = Pick<MailMessage, 'id' | 'html' | 'attachments'>;

/** The `cid`s the latest messages' bodies load, so a body is read once rather than per render. */
const shownCache = new Map<string, { html: string; cids: ReadonlySet<string> }>();
const SHOWN_KEPT = 32;
const NONE: ReadonlySet<string> = new Set();

/** The `cid`s (lower case) a message's HTML body loads as images or backgrounds. */
function shownCids(message: StripMessage): ReadonlySet<string> {
	const markup = message.html;
	if (!markup || !message.attachments.some((a) => a.cid)) return NONE;
	const known = shownCache.get(message.id);
	if (known?.html === markup) return known.cids;
	const cids = new Set(sanitizeEmailHtml(markup, { allowRemote: false }).cids);
	shownCache.delete(message.id);
	shownCache.set(message.id, { html: markup, cids });
	if (shownCache.size > SHOWN_KEPT) shownCache.delete(shownCache.keys().next().value!);
	return cids;
}

/**
 * The image parts a message's HTML body shows in place (through `cid:`), whatever their
 * disposition. A part the body only links to, or one that is not an image, is not one of them.
 */
export function bodyImages(message: StripMessage): MailAttachment[] {
	const shown = shownCids(message);
	return message.attachments.filter(
		(a) => !!a.cid && a.type.startsWith('image/') && shown.has(a.cid.toLowerCase()),
	);
}

/**
 * The files of a message: every part but the images its HTML body shows in place. A part the body
 * only links to, or one that is not an image, can only be opened from here, and one the sender
 * attached as a file stays a file.
 */
export function attachmentStrip(
	message: StripMessage,
	i18n: MailI18n,
	handlers: AttachmentHandlers,
) {
	const inPlace = new Set(bodyImages(message));
	const listed = message.attachments.filter(
		(a) => a.disposition === 'attachment' || !inPlace.has(a),
	);
	if (!listed.length) return nothing;
	return html`<ul class="attachments" aria-label=${i18n.tn('reading.attachments', listed.length)}>
		${listed.map((attachment) => {
			const kind = previewKind(attachment);
			const ext = attachment.name.includes('.')
				? attachment.name.split('.').pop()!.toUpperCase()
				: '';
			return html`<li class="attachment">
				<span class="kind" style=${`background:${kindColor(kind)}`} aria-hidden="true"
					>${ext.slice(0, 4) || icon('mail-attach')}</span
				>
				<span class="file">
					<span class="file-name" title=${attachment.name}>${attachment.name}</span>
					<span class="file-size">${fileSize(attachment.size, i18n)}</span>
				</span>
				${
					kind
						? html`<button
								type="button"
								aria-label=${i18n.t('reading.previewFile', { name: attachment.name })}
								title=${i18n.t('reading.preview')}
								@click=${() => handlers.preview(attachment)}
								>${icon('mail-eye')}</button
							>`
						: nothing
				}
				<button
					type="button"
					aria-label=${i18n.t('reading.downloadFile', { name: attachment.name })}
					title=${i18n.t('reading.download')}
					@click=${() => handlers.download(attachment)}
					>${icon('mail-download')}</button
				>
			</li>`;
		})}
	</ul>`;
}
