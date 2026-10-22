import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Tests run against this repository's ooxml-core and ooxml-ui source (no build needed), like the
// demo. With NOTEBOOK_USE_DIST=1, or without that source (a copy of the viewer on its own), they
// run against the ooxml-core and ooxml-ui installed in node_modules.
const ooxml = fileURLToPath(new URL(process.env.OOXML_DIR ?? '../../', import.meta.url)).replaceAll(
	String.fromCharCode(92),
	'/',
);
const useSource =
	process.env.NOTEBOOK_USE_DIST !== '1' && existsSync(`${ooxml}src/core/notebook/index.ts`);

export default {
	resolve: {
		dedupe: ['yjs', 'lib0', 'y-protocols', 'lit'],
		alias: [
			...(useSource
				? [
						{ find: /^ooxml-core\/(.+)$/, replacement: `${ooxml}src/core/$1/index.ts` },
						{ find: /^ooxml-ui$/, replacement: `${ooxml}src/ui/src/index.ts` },
						{ find: /^ooxml-ui\/notebook$/, replacement: `${ooxml}src/ui/src/notebook/index.ts` },
					]
				: []),
			{
				find: /^notebook-viewer$/,
				replacement: fileURLToPath(
					new URL('./packages/web-component/src/index.ts', import.meta.url),
				),
			},
		],
	},
	server: { fs: { strict: false } },
	test: {
		globals: true,
		environment: 'jsdom',
		include: ['packages/*/src/**/*.test.ts'],
		exclude: ['node_modules', 'dist'],
		testTimeout: 15000,
	},
};
