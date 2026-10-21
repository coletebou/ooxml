// Glyphs the mail elements draw, registered in the shared ooxml-ui icon registry (20x20 stroke
// paths) under a `mail-` prefix so they never replace another product's icon of the same name.
// `icon(name)` renders one inline; built-in names (`search`, `trash`, `close`, ...) work too.
import { html, svg, type TemplateResult } from 'lit';
import { getIcon, registerIcon } from '../icons';

const GLYPHS: Record<string, string> = {
	'mail-inbox': 'M3 11h4l1.5 2.5h3L13 11h4M3 11l2.5-6.5h9L17 11v5H3Z',
	'mail-drafts': 'M4 3h8l4 4v10H4ZM12 3v4h4M7 11h6M7 14h4',
	'mail-sent': 'M3 10 17 3l-4 14-3-6Zm7 1 7-8',
	'mail-archive': 'M3 4h14v3H3ZM4.5 7v9h11V7M8 10h4',
	'mail-junk': 'M3 10a7 7 0 1 0 14 0 7 7 0 1 0-14 0M5 5l10 10',
	'mail-folder': 'M3 5.5h5l1.5 2H17v8H3Z',
	'mail-envelope': 'M3 5h14v10H3ZM3 5l7 6 7-6',
	'mail-open': 'M3 8l7-5 7 5v8H3ZM3 8l7 5 7-5',
	'mail-flag': 'M5 17V3M5 3.5h10l-2 3.5 2 3.5H5',
	'mail-reply': 'M8 4 3 9l5 5M3 9h9a5 5 0 0 1 5 5v2',
	'mail-reply-all': 'M10 4 5 9l5 5M6 4 1 9l5 5M5 9h8a5 5 0 0 1 5 5v2',
	'mail-forward': 'm12 4 5 5-5 5M17 9H8a5 5 0 0 0-5 5v2',
	'mail-attach':
		'M15 9.5l-5.5 5.5a3.5 3.5 0 0 1-5-5l6-6a2.3 2.3 0 0 1 3.3 3.3l-6 6a1.2 1.2 0 0 1-1.7-1.7L11 6',
	'mail-calendar': 'M3.5 5h13v11.5h-13ZM3.5 8.5h13M7 3v3M13 3v3',
	'mail-contacts':
		'M7 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM2.5 16c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M13 8.5a2 2 0 1 0 0-4M14 12c2 .3 3.5 1.6 3.5 4',
	'mail-more': 'M5 10h.01M10 10h.01M15 10h.01',
	'mail-refresh': 'M16 10a6 6 0 1 1-1.8-4.2M16 4v4h-4',
	'mail-thread': 'M3 4h10v7H7l-4 3ZM13 8h4v7l-3-2H9v-2',
	'mail-menu': 'M3 5h14M3 10h14M3 15h14',
	'mail-download': 'M10 3v10M6 9l4 4 4-4M3 16h14',
	'mail-eye':
		'M2.5 10S5.5 5 10 5s7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5ZM8 10a2 2 0 1 0 4 0 2 2 0 1 0-4 0',
	'mail-image': 'M3 4h14v12H3ZM3 13l4-4 3 3 2-2 5 5M12.5 7.5h.01',
	'mail-link':
		'M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.8.8M11.5 8.5a3 3 0 0 0-4.2 0L4.7 11.1a3 3 0 0 0 4.2 4.2l.8-.8',
	'mail-quote': 'M5 6h3v4H5Zm0 4c0 2-1 3-2 3.5M12 6h3v4h-3Zm0 4c0 2-1 3-2 3.5',
	'mail-numbered': 'M8 5h9M8 10h9M8 15h9M3 4l1-.5V7M3 9h2l-2 2.5h2M3 14h2l-1 1 1 1H3',
	'mail-clear-format': 'M5 4h10M10 4l-3 12M4 16l12-12',
	'mail-person': 'M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4 17c0-3 2.7-5 6-5s6 2 6 5',
	'mail-import': 'M10 13V3M6 9l4 4 4-4M3 12v5h14v-5',
	'mail-export': 'M10 13V3M6 7l4-4 4 4M3 12v5h14v-5',
	'mail-today': 'M3.5 5h13v11.5h-13ZM3.5 8.5h13M7 3v3M13 3v3M9 12h2v2H9Z',
	'mail-account':
		'M3 10a7 7 0 1 0 14 0 7 7 0 1 0-14 0M10 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM5.5 15c1-1.8 2.6-2.5 4.5-2.5s3.5.7 4.5 2.5',
	'mail-keyboard':
		'M2.5 5h15v10h-15ZM5 8h.01M8 8h.01M11 8h.01M14 8h.01M5 11h.01M14 11h.01M7.5 12h5',
};
for (const [name, d] of Object.entries(GLYPHS)) registerIcon(name, d);

/** An inline 20x20 icon by registry name; empty when unknown. */
export function icon(name: string): TemplateResult | '' {
	const found = getIcon(name);
	if (!found) return '';
	return html`<svg class="icon" viewBox=${found.viewBox ?? '0 0 20 20'} aria-hidden="true">
		${svg`<path d=${found.d}></path>`}
	</svg>`;
}

/** The icon of a folder by its special-use role. */
export function mailboxIcon(role: string | null): string {
	switch (role) {
		case 'inbox':
			return 'mail-inbox';
		case 'drafts':
			return 'mail-drafts';
		case 'sent':
			return 'mail-sent';
		case 'archive':
			return 'mail-archive';
		case 'junk':
			return 'mail-junk';
		case 'trash':
			return 'trash';
		default:
			return 'mail-folder';
	}
}
