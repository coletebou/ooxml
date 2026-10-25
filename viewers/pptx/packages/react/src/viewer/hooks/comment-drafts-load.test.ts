import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * A new deck clears the viewer's store of unposted comments (slide ids repeat across files), in the
 * load's `onContentApplied`, before the next render syncs the comments pane with the new slides.
 */
describe('comment drafts on load', () => {
	it('clears the drafts store when new content is applied', () => {
		const source = readFileSync(new URL('./useViewerIntegration.ts', import.meta.url), 'utf8');
		const applied = source.slice(source.indexOf('onContentApplied:'));
		expect(applied.slice(0, 200)).toMatch(/commentDrafts\.clear\(\)/);
	});
});
