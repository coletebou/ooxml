// The shared token test renders only the `office-ui-*` tags, so the notebook's stylesheets get the
// same rules here: no raw colour or pixel length outside a token, and only declared tokens.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { OFFICE_TOKENS } from '../tokens';

// Vitest runs from the package root (`src/ui`).
const dir = `${resolve('src/notebook')}/`;
const sheets = readdirSync(dir).filter((name) => name.endsWith('.css'));

describe('notebook stylesheets', () => {
	it('exist', () => {
		expect(sheets.length).toBeGreaterThan(5);
	});

	it.each(sheets)('%s uses tokens, not raw colours or pixel lengths', (name) => {
		let text = readFileSync(`${dir}${name}`, 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
		text = text.replace(/@media[^{]*\{/gu, '{');
		for (let i = 0; i < 4; i++)
			text = text.replace(/var\(--[\w-]+(?:,(?:[^()]|\([^()]*\))*)?\)/gu, 'T');
		expect(
			text.match(/#[0-9a-f]{3,8}\b|(?<![\w.])-?\d*\.?\d+px\b|rgba?\([^)]*\)/giu) ?? [],
		).toEqual([]);
	});

	it.each(sheets)('%s references only declared tokens', (name) => {
		const text = readFileSync(`${dir}${name}`, 'utf8');
		const used = [...text.matchAll(/var\((--office-[\w-]+)/gu)].map((m) => m[1]!);
		expect(used.filter((token) => !(token in OFFICE_TOKENS))).toEqual([]);
	});
});
