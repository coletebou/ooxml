import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * A new document clears the comments wiring's store of unposted comments (slide ids repeat across
 * files), in the watch that resets the view state when the `content` input changes.
 */
describe('comment drafts on load', () => {
	it('clears the drafts store with the rest of the view state', () => {
		const source = readFileSync(resolve(process.cwd(), 'src/viewer/PowerPointViewer.vue'), 'utf8');
		const reset = source.slice(source.indexOf('watch(activeContent, () => {'));
		expect(reset.slice(0, reset.indexOf('\n});'))).toMatch(/commentDrafts\.clear\(\)/);
	});
});
