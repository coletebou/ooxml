// Builds the GitHub Pages site: the VitePress documentation in docs/, then the demo into its own
// route under docs/.vitepress/dist. Adapted from the teams viewer's scripts/build-pages.mjs.
//
// Pages is static, and the notebook needs no server: the demo runs the same local-first notebook
// as anywhere else (notebooks in this browser's IndexedDB, tabs of one browser shared over
// BroadcastChannel), so it is built as it is, with no static-site flag.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = resolve(root, 'docs');
const dist = resolve(docs, '.vitepress', 'dist');
const node = process.execPath;
const vitepressCli = resolve(docs, 'node_modules', 'vitepress', 'bin', 'vitepress.js');
const viteCli = resolve(root, 'node_modules', 'vite', 'bin', 'vite.js');
const base = '/ooxml/notebook/';
// `/demo/` is the React demo, the only binding so far; later bindings get `/demo-<framework>/`
// routes like the other viewers' sites.
const demos = [{ dir: 'react', route: 'demo' }];

function run(script, args, cwd, env = process.env) {
	const result = spawnSync(node, [script, ...args], { cwd, env, stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(`Command failed (${result.status}): ${script} ${args.join(' ')}`);
}

if (!existsSync(vitepressCli)) {
	throw new Error(
		'VitePress is missing. Install the docs dependencies with `bun install --cwd docs`.',
	);
}
if (!existsSync(viteCli)) {
	throw new Error('Vite is missing. Install the workspace dependencies with `bun install`.');
}

run(vitepressCli, ['build', '.'], docs);

for (const { dir, route } of demos) {
	const outDir = resolve(dist, route);
	if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
	mkdirSync(outDir, { recursive: true });
	run(
		viteCli,
		['build', '--base', `${base}${route}/`, '--outDir', outDir, '--emptyOutDir'],
		resolve(root, '..', '..', 'demos', 'notebook', dir),
	);
	const index = resolve(outDir, 'index.html');
	if (!existsSync(index) || statSync(index).size === 0) {
		throw new Error(`The ${dir} demo build did not produce ${index}`);
	}
}

console.log(
	`Built the documentation and ${demos.length} demo(s): ${demos.map((d) => `${base}${d.route}/`).join(', ')}`,
);
