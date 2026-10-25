import { describe, expect, it } from 'vitest';

import paneCss from '../../comments/comments-pane.css?raw';
import { HOST_STYLES } from './host-styles';

/** The declarations of the first rule whose selector is exactly `selector`, by property. */
function declarations(css: string, selector: string): Record<string, string> {
	const start = css.search(new RegExp(`^${selector.replace(/[[\]().:]/g, '\\$&')} \\{`, 'm'));
	expect(start, selector).toBeGreaterThanOrEqual(0);
	const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
	return Object.fromEntries(
		body
			.split(';')
			.map((declaration) => declaration.trim())
			.filter(Boolean)
			.map((declaration) => {
				const colon = declaration.indexOf(':');
				return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
			}),
	);
}

describe('pptx host styles', () => {
	it('frames a stand-alone comments pane from the document, where the viewer reset cannot undo it', () => {
		// The viewer's preflight (`:where([data-pptx-viewer]) * { padding: 0; border: 0 solid }`)
		// is a document rule, and a document rule beats the pane's own `:host` box.
		const own = declarations(paneCss, ':host');
		const host = declarations(HOST_STYLES, 'pptx-ui-comments-pane');
		expect(host.padding).toBe(own.padding);
		expect(host['border-inline-start']).toBe(own['border-inline-start']);
	});

	it('leaves a list-only or embedded comments pane to the surface that frames it', () => {
		expect(
			declarations(HOST_STYLES, 'pptx-ui-comments-pane:is([list-only], [data-pptx-embedded])'),
		).toStrictEqual({ padding: '0', border: '0', background: 'transparent' });
	});
});
