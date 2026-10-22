// The mail stylesheets follow the ooxml-ui rule: colours and lengths only through tokens, and only
// tokens that exist. (The shared token test covers the `office-ui-*` controls; this covers mail.)
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { OFFICE_TOKENS } from '../tokens';

// Node's URL: the DOM environment's global `URL` is not one `fileURLToPath` accepts.
const dir = fileURLToPath(new NodeURL('.', import.meta.url));
const sheets = readdirSync(dir)
	.filter((file) => file.endsWith('.css'))
	.map((file) => [file, readFileSync(`${dir}${file}`, 'utf8')] as const);

/** The CSS without comments, token references and media or container conditions. */
function outsideTokens(css: string): string {
	let text = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@(media|container)[^{]*\{/g, '{');
	for (let i = 0; i < 5; i++)
		text = text.replace(/var\(--[\w-]+(?:,(?:[^()]|\([^()]*\))*)?\)/g, 'T');
	return text;
}

describe('mail stylesheets', () => {
	it('exist', () => {
		expect(sheets.length).toBeGreaterThan(8);
	});

	it.each(sheets)('%s has no raw colours or pixel lengths', (_file, css) => {
		expect(
			outsideTokens(css).match(/#[0-9a-f]{3,8}\b|(?<![\w.])-?\d*\.?\d+px\b|rgba?\([^)]*\)/gi),
		).toBeNull();
	});

	it.each(sheets)('%s references only declared tokens', (_file, css) => {
		const unknown = [...css.matchAll(/var\((--office-[\w-]+)/g)]
			.map((match) => match[1]!)
			.filter((name) => !(name in OFFICE_TOKENS));
		expect(unknown).toEqual([]);
	});
});
