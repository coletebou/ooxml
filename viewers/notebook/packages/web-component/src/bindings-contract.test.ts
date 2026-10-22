// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The component bindings are checked at the source, the same way for every framework: each one
// routes props, events and the host class through bindNotebook and applies them before the
// element's first update. React also has a rendering test of its own (react/src/index.test.ts).
const bindings = {
	react: 'react/src/index.ts',
} as const;
const classProp = {
	react: /className/,
} as const;
/** How each binding applies props before the element's first update (a microtask after connect). */
const beforeFirstUpdate = {
	react: /useLayoutEffect\(\(\) => \{\s*binding\.current\?\.update\(pickNotebookProps\(props\)\);/u,
} as const;

const read = (file: string): string =>
	readFileSync(resolve(process.cwd(), 'packages', file), 'utf8');

describe.each(Object.entries(bindings))('%s binding', (name, file) => {
	const source = read(file);
	const key = name as keyof typeof bindings;
	it('uses the shared bindNotebook wiring instead of its own copy', () => {
		expect(source).toContain('bindNotebook(');
		expect(source).toContain('pickNotebookProps(');
		expect(source).not.toContain('applyNotebookProps(');
		expect(source).not.toContain('listenNotebookEvents(');
	});
	it('accepts a host class', () => {
		expect(source).toMatch(classProp[key]);
	});
	it('applies props before the element starts its client', () => {
		expect(source).toMatch(beforeFirstUpdate[key]);
	});
	it('exposes the raw hook', () => {
		expect(source).toContain('createNotebook(');
	});
});

describe('the binding packages', () => {
	it('never depend on the private web component or a local range', () => {
		for (const name of Object.keys(bindings)) {
			const manifest = JSON.parse(read(`${name}/package.json`)) as Record<
				string,
				Record<string, string> | undefined
			>;
			for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
				const entries = Object.entries(manifest[field] ?? {});
				expect(entries.map(([dep]) => dep)).not.toContain('notebook-viewer');
				for (const [dep, range] of entries)
					expect(range, `${name} ${field}.${dep}`).not.toMatch(/^(?:workspace|file|link):/u);
			}
		}
	});
});
