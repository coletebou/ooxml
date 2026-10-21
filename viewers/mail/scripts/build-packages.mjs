import { mkdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'vite';
import { rollup } from 'rollup';
import { dts } from 'rollup-plugin-dts';

/**
 * Builds the published framework packages (`openmail-<framework>-viewer`; React in the first cut).
 * Adapted from viewers/teams/scripts/build-packages.mjs. The private web component (`mail-viewer`,
 * `packages/web-component`) is inlined into every bundle; everything a manifest declares
 * (`ooxml-core`, `ooxml-ui`, `lit` and the framework peer) stays an import, so a tarball imports
 * nothing a consumer cannot install. Declarations are flattened the same way.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = path.join(root, 'packages');
const typesDir = path.join(root, '.release-types');

/** Published packages and the source entry behind each emitted `dist/<name>.js`. */
export const PUBLISHED = {
	react: { index: 'src/index.ts' },
};

/** Private workspace packages that get inlined, by import specifier -> source file. */
export const INTERNAL_SOURCES = new Map([['mail-viewer', 'packages/web-component/src/index.ts']]);

const run = (command, args) => {
	const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
	if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
};
const readManifest = async (name) =>
	JSON.parse(await readFile(path.join(packagesDir, name, 'package.json'), 'utf8'));
const isDependency = (names) => (id) =>
	names.some((name) => id === name || id.startsWith(`${name}/`));
const dependencyNames = (manifest) => [
	...Object.keys(manifest.dependencies ?? {}),
	...Object.keys(manifest.peerDependencies ?? {}),
];

async function buildJavaScript(name, manifest, distDir) {
	await build({
		configFile: false,
		root: path.join(packagesDir, name),
		logLevel: 'warn',
		resolve: {
			alias: [...INTERNAL_SOURCES].map(([find, file]) => ({
				find: new RegExp(`^${find}$`),
				replacement: path.join(root, file),
			})),
		},
		build: {
			target: 'es2022',
			outDir: distDir,
			emptyOutDir: false,
			minify: false,
			lib: {
				entry: Object.fromEntries(
					Object.entries(PUBLISHED[name]).map(([key, file]) => [
						key,
						path.join(packagesDir, name, file),
					]),
				),
				formats: ['es'],
				fileName: (_format, entryName) => `${entryName}.js`,
			},
			rollupOptions: { external: isDependency(dependencyNames(manifest)) },
		},
	});
}

/** Inlines internal declarations into one flat `.d.ts` per entry; dependencies stay imports. */
async function bundleDeclarations(name, manifest, distDir) {
	const internal = new Map(
		[...INTERNAL_SOURCES].map(([id, file]) => [
			id,
			path.join(typesDir, file.replace(/\.tsx?$/, '.d.ts')),
		]),
	);
	const isExternal = isDependency(dependencyNames(manifest));
	for (const key of Object.keys(PUBLISHED[name])) {
		const bundle = await rollup({
			input: path.join(typesDir, 'packages', name, 'src', `${key}.d.ts`),
			external: (id) =>
				!internal.has(id) && !id.startsWith('.') && !path.isAbsolute(id) && isExternal(id),
			onwarn: (warning, warn) => {
				if (warning.code !== 'UNUSED_EXTERNAL_IMPORT') warn(warning);
			},
			plugins: [
				{ name: 'internal-declarations', resolveId: (id) => internal.get(id) ?? null },
				dts(),
			],
		});
		await bundle.write({ file: path.join(distDir, `${key}.d.ts`), format: 'es' });
		await bundle.close();
	}
}

async function main() {
	await rm(typesDir, { recursive: true, force: true });
	run(process.execPath, [
		path.join(root, 'node_modules/typescript/bin/tsc'),
		'--project',
		'tsconfig.release.json',
	]);
	for (const name of Object.keys(PUBLISHED)) {
		const distDir = path.join(packagesDir, name, 'dist');
		await rm(distDir, { recursive: true, force: true });
		await mkdir(distDir, { recursive: true });
		const manifest = await readManifest(name);
		await buildJavaScript(name, manifest, distDir);
		await bundleDeclarations(name, manifest, distDir);
	}
	await rm(typesDir, { recursive: true, force: true });
	console.log(`Built ${Object.keys(PUBLISHED).length} publishable framework package(s).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
