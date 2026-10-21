import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { forbiddenManifestEntries, undeclaredImports } from './check-published-refs.mjs';

/**
 * Packs the published framework packages (React today), installs the tarballs into a clean
 * consumer and exercises them: every entry imports in Node without a DOM, the declarations
 * type-check in a strict consumer, and no tarball imports, bundles or installs the private web
 * component. Adapted from the teams viewer's `scripts/pack-smoke.mjs`; the browser behaviour
 * itself is covered by the vitest (jsdom) suite and the Playwright specs, not here.
 *
 * By default ooxml-core and ooxml-ui come from the registry, as a consumer gets them. Before the
 * release that adds a subpath the bindings need, set NOTEBOOK_SMOKE_LOCAL_OOXML=1 to pack the
 * workspace's own `src/core` and `src/ui` (built first: `bun run build` and
 * `bun run --cwd src/ui build` at the repository root) and install them with the bindings.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = path.resolve(root, '..', '..');
const localOoxml = process.env.NOTEBOOK_SMOKE_LOCAL_OOXML === '1';
const work = await mkdtemp(path.join(tmpdir(), 'opennotes-package-smoke-'));
const npmCli =
	process.platform === 'win32'
		? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
		: 'npm';
const run = (command, args, options = {}) => {
	const executable = command === 'npm' && process.platform === 'win32' ? process.execPath : command;
	const executableArgs =
		command === 'npm' && process.platform === 'win32' ? [npmCli, ...args] : args;
	const result = spawnSync(executable, executableArgs, { cwd: root, encoding: 'utf8', ...options });
	if (result.status !== 0)
		throw new Error(
			`${command} ${args.join(' ')} failed${result.error ? `: ${result.error.message}` : ''}\n${result.stdout}\n${result.stderr}`,
		);
	return result.stdout;
};

const FRAMEWORKS = ['react'];
const entryOf = () => 'dist/index.js';
const npmName = (name) => `opennotes-${name}-viewer`;
/** The subpaths of ooxml-core and ooxml-ui the bindings import. */
const REQUIRED_SUBPATHS = { 'ooxml-core': ['./notebook'], 'ooxml-ui': ['./notebook'] };

async function files(directory) {
	const result = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const target = path.join(directory, entry.name);
		if (entry.isDirectory()) result.push(...(await files(target)));
		else result.push(target);
	}
	return result;
}

/** Inspects the extracted tarball: manifest, entry files and every import it ships. */
async function inspectTarball(name, packed, directory) {
	const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
	assert.equal(manifest.name, npmName(name));
	assert.equal(manifest.private, undefined, `${packed.name} must not be private`);
	assert(!JSON.stringify(manifest).includes('workspace:'), `${packed.name} has a workspace: range`);
	assert(!JSON.stringify(manifest).includes('file:'), `${packed.name} has a file: range`);
	assert.deepEqual(forbiddenManifestEntries(manifest), [], `${packed.name} manifest`);
	assert.equal(manifest.license, 'Apache-2.0');
	for (const required of ['README.md', 'LICENSE', 'NOTICE', entryOf(name), 'dist/index.d.ts'])
		assert(
			packed.files.some((entry) => entry.path === required),
			`${packed.name} does not ship ${required}`,
		);
	assert(
		!packed.files.some((entry) => /\.test\.|(?:^|\/)src\//u.test(entry.path)),
		`${packed.name} ships tests or sources`,
	);
	assert.deepEqual(
		Object.keys(manifest.dependencies)
			.filter((dep) => /^(?:@christophervr\/|notebook-|opennotes-|ooxml-)/u.test(dep))
			.sort(),
		['ooxml-core', 'ooxml-ui'],
		`${packed.name} may depend on no project package but ooxml-core and ooxml-ui`,
	);
	// `*` tracks the latest release in this repository; the publish step rewrites it to a caret.
	for (const dep of ['ooxml-core', 'ooxml-ui'])
		assert.match(manifest.dependencies[dep], /^(?:\*|\^\d+\.\d+\.\d+)$/u, `${packed.name} ${dep}`);
	for (const file of await files(directory)) {
		if (!/\.(?:m?js|d\.ts)$/u.test(file)) continue;
		assert.deepEqual(
			undeclaredImports(await readFile(file, 'utf8'), manifest),
			[],
			`${packed.name} imports an undeclared or unpublished module in ${path.relative(directory, file)}`,
		);
	}
	return manifest;
}

/** The installed ooxml packages export what the bindings import, or the release is still due. */
async function checkOoxmlSubpaths(installed) {
	for (const [name, subpaths] of Object.entries(REQUIRED_SUBPATHS)) {
		const manifest = JSON.parse(await readFile(path.join(installed, name, 'package.json'), 'utf8'));
		const missing = subpaths.filter((subpath) => !manifest.exports?.[subpath]);
		if (missing.length > 0)
			throw new Error(
				`${name}@${manifest.version} has no ${missing.join(', ')} export. The bindings need a ` +
					'release of it that does: release it first (docs/linked-changes.md), or run with ' +
					'NOTEBOOK_SMOKE_LOCAL_OOXML=1 to smoke-test against the workspace copies.',
			);
	}
}

const consumerSource = `import assert from 'node:assert/strict';
${FRAMEWORKS.map((name) => `import * as ${name} from '${npmName(name)}';`).join('\n')}
assert.equal(typeof globalThis.document, 'undefined', 'SSR import must not require a DOM');
const frameworks = { ${FRAMEWORKS.join(', ')} };
const exportsOf = {
	react: ['Notebook', 'useNotebook', 'useNotebookClient', 'useNotebookState'],
};
for (const [name, entry] of Object.entries(frameworks))
	for (const member of exportsOf[name]) assert.ok(entry[member], name + ' must export ' + member);
`;

const typingSource = `import { createElement } from 'react';
import {
	Notebook,
	useNotebook,
	useNotebookClient,
	useNotebookState,
	type CreateNotebookOptions,
	type NotebookApp,
	type NotebookClient,
	type NotebookProps,
	type NotebookState,
} from 'opennotes-react-viewer';
const props: NotebookProps = { userName: 'Ada', storageName: 'notes', theme: 'dark' };
const options: CreateNotebookOptions = { user: { name: 'Ada' }, storageName: 'notes' };
const client: NotebookClient | null = null;
const state: NotebookState | null = null;
const element: NotebookApp | null = null;
const tree = createElement(Notebook, { ...props, className: 'notes' });
void [options, client, state, element, tree, useNotebook, useNotebookClient, useNotebookState];
`;

/** `npm pack` one directory into the work folder; returns npm's description of the tarball. */
const pack = (directory, extra = []) =>
	JSON.parse(run('npm', ['pack', '--json', ...extra, '--pack-destination', work, directory]))[0];

try {
	const tarballs = [];
	const peers = new Map();
	const inspected = path.join(work, 'inspect');
	for (const name of FRAMEWORKS) {
		const packed = pack(path.join(root, 'packages', name));
		tarballs.push(path.join(work, packed.filename));
		const target = path.join(inspected, name);
		await mkdir(target, { recursive: true });
		// Relative paths: GNU tar (Git for Windows) reads `C:` as a remote host.
		run('tar', ['-xzf', packed.filename, '--strip-components=1', '-C', `inspect/${name}`], {
			cwd: work,
		});
		const manifest = await inspectTarball(name, packed, target);
		for (const [dependency, version] of Object.entries(manifest.peerDependencies ?? {}))
			peers.set(dependency, version);
	}
	if (localOoxml)
		for (const dir of ['src/core', 'src/ui'])
			tarballs.push(
				path.join(work, pack(path.join(repository, dir), ['--ignore-scripts']).filename),
			);
	await writeFile(
		path.join(work, 'package.json'),
		JSON.stringify({ private: true, type: 'module' }),
	);
	run(
		'npm',
		[
			'install',
			'--ignore-scripts',
			'--no-audit',
			'--no-fund',
			'--package-lock=false',
			...tarballs,
			...Array.from(peers, ([name, version]) => `${name}@${version}`),
			// The typing check below compiles against React's own declarations.
			'@types/react@^19',
		],
		{ cwd: work },
	);
	const installed = path.join(work, 'node_modules');
	assert.deepEqual(
		(await readdir(installed)).filter((name) => /^notebook-|^@christophervr$/u.test(name)),
		[],
		'no internal package may be installed alongside the published ones',
	);
	await checkOoxmlSubpaths(installed);

	await writeFile(path.join(work, 'consumer.mjs'), consumerSource);
	run('node', [path.join(work, 'consumer.mjs')], { cwd: work });
	await writeFile(path.join(work, 'consumer.ts'), typingSource);
	run(
		'node',
		[
			path.join(root, 'node_modules/typescript/bin/tsc'),
			...['--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'ESNext'],
			...['--moduleResolution', 'bundler', '--types', ''],
			path.join(work, 'consumer.ts'),
		],
		{ cwd: work },
	);
	for (const name of FRAMEWORKS) {
		const bundle = await readFile(path.join(inspected, name, entryOf(name)), 'utf8');
		// The element lives in ooxml-ui; the package imports it instead of bundling a copy.
		assert(
			bundle.includes('ooxml-ui/notebook'),
			`${name}: the <notebook-app> element must come from the ooxml-ui/notebook dependency`,
		);
		assert(
			!bundle.includes('class NotebookApp'),
			`${name}: the element's code must not be bundled into the package`,
		);
	}
	console.log(
		`Packed consumer imports, typings and bundle checks succeeded for ${FRAMEWORKS.map(npmName).join(', ')}` +
			(localOoxml ? ' (against the workspace ooxml-core and ooxml-ui).' : '.'),
	);
} finally {
	await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
