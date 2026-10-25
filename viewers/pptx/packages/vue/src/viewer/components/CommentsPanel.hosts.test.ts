import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Every host of `CommentsPanel` hands it what the shared pane needs to behave the same on each
 * surface: the viewer's drafts store and the slide they belong to, and (where an element can be
 * selected while it shows) the selection a new comment goes on. `SlideInspector` only shows with
 * no single element selected (`SlideDeckInspector`), so it has no selection to pass.
 */
const panelOf = (file: string) => {
	const source = readFileSync(new URL(file, import.meta.url), 'utf8');
	const start = source.indexOf('<CommentsPanel');
	return source.slice(start, source.indexOf('/>', start));
};

describe('commentsPanel hosts', () => {
	it.each(['./ViewerSidePanels.vue', './ViewerMobileSheets.vue', './inspector/SlideInspector.vue'])(
		'%s passes the drafts store and the draft key',
		(file) => {
			expect(panelOf(file)).toMatch(/:drafts="/);
			expect(panelOf(file)).toMatch(/:draft-key="/);
		},
	);

	it.each(['./ViewerSidePanels.vue', './ViewerMobileSheets.vue'])(
		'%s passes the selection',
		(file) => {
			expect(panelOf(file)).toMatch(/:selected-element-id="/);
		},
	);
});
