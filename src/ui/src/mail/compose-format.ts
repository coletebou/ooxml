// The formatting bar of <mail-compose>: a button for each editing command of the browser it runs on
// the editor (bold, lists, a quote, a link, clearing the formatting). A press keeps the focus and
// the selection in the editor. New code.
import { html } from 'lit';
import type { MailI18n, MailKey } from './i18n/translator';
import { icon } from './icons';

/** Editing command, glyph, label and command value of each formatting button. */
const FORMATS: readonly { command: string; glyph: string; label: MailKey; value?: string }[] = [
	{ command: 'bold', glyph: 'bold', label: 'compose.bold' },
	{ command: 'italic', glyph: 'italic', label: 'compose.italic' },
	{ command: 'underline', glyph: 'underline', label: 'compose.underline' },
	{ command: 'strikeThrough', glyph: 'strikethrough', label: 'compose.strikethrough' },
	{ command: 'insertUnorderedList', glyph: 'bullets', label: 'compose.bullets' },
	{ command: 'insertOrderedList', glyph: 'mail-numbered', label: 'compose.numbered' },
	{ command: 'formatBlock', glyph: 'mail-quote', label: 'compose.quote', value: 'blockquote' },
	{ command: 'createLink', glyph: 'mail-link', label: 'compose.link' },
	{ command: 'removeFormat', glyph: 'mail-clear-format', label: 'compose.clearFormat' },
];

/** The formatting bar; `run` gets the editing command and value of each button pressed. */
export function formatBar(i18n: MailI18n, run: (command: string, value?: string) => void) {
	return html`<div class="format" role="toolbar" aria-label=${i18n.t('compose.formatting')}>
		${FORMATS.map(
			(f) =>
				html`<button
					type="button"
					class="icon-button"
					aria-label=${i18n.t(f.label)}
					title=${i18n.t(f.label)}
					@mousedown=${(e: Event) => e.preventDefault()}
					@click=${() => run(f.command, f.value)}
					>${icon(f.glyph)}</button
				>`,
		)}
	</div>`;
}
