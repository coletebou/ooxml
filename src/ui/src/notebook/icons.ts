// Glyphs the notebook draws that the shared icon set lacks, registered under a `notebook-`
// prefix in the shared registry (20x20 stroke paths, like every ooxml-ui icon).
import { registerIcon } from '../icons';

const GLYPHS: Record<string, string> = {
	highlight: 'M5 15l2.5-2.5M7 13l7-7 2 2-7 7H7ZM12 8l2 2M3 17h14',
	numbering:
		'M8 5h9M8 10h9M8 15h9M3 4l1-.5V7M3 7h2M3 9.5c.5-.7 2-.7 2 .3 0 .8-2 1.7-2 2.7h2M3 14h2l-1 1.2c1 0 1.2 1.8 0 1.8H3',
	todo: 'M3.5 3.5h6v6h-6ZM5 6.5l1.2 1.2 2-2.4M12 6.5h5M3.5 11.5h6v6h-6ZM12 14.5h5',
	link: 'M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1',
	picture: 'M3 4h14v12H3ZM3 13l4-4 3 3 2-2 5 5M13 7.5h.01',
	highlighter: 'M6 17h8M7.5 14l-1-3 6-7 3 3-7 6.5ZM10 9l2 2',
	eraser: 'M4 13.5 11 6.5l4 4-5.5 5.5H6.5ZM8 16h9M7.5 10l4 4',
	download: 'M10 3v10M6 9l4 4 4-4M4 16h12',
	page: 'M5 2.5h7l3 3v12H5ZM12 2.5v3h3',
	subpage: 'M6 4h7l2 2v10H6ZM3 7v9h1',
	section: 'M4 4h12v12H4ZM7.5 4v12',
	group: 'M3 5h5l1.5 2H17v8H3ZM3 9h14',
	notebook: 'M5 3h10v14H5ZM5 6H3.5M5 10H3.5M5 14H3.5M8 3v14',
	type: 'M7 4h6M10 4v12M7 16h6',
	pane: 'M3 4h14v12H3ZM7.5 4v12',
	textBox: 'M3 5h14v10H3ZM6 8h8M6 11h5',
	file: 'M5 2.5h7l3 3v12H5ZM12 2.5v3h3M7.5 10h5M7.5 13h5',
	archive: 'M3 4h14v3H3ZM4 7v9h12V7M8 10h4',
	import: 'M10 13V3M6 7l4-4 4 4M4 16h12',
};

let registered = false;

/** Register the notebook glyphs (idempotent). An explicit call, so no bundler drops it. */
export function registerNotebookIcons(): void {
	if (registered) return;
	registered = true;
	for (const [name, d] of Object.entries(GLYPHS)) registerIcon(`notebook-${name}`, d);
}
