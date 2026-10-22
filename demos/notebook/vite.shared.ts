import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { UserConfig } from 'vite';

// The demos run against this repository's own source. By default a demo resolves ooxml-core and
// ooxml-ui from their SOURCE when it exists (instant reload when you edit either; otherwise the
// packages in node_modules), and the binding packages of viewers/notebook from their source too.
// NOTEBOOK_USE_DIST=1 uses the built packages for both (run `bun run build:packages` in
// viewers/notebook first for its own ones).
const ooxml = fileURLToPath(new URL(process.env.OOXML_DIR ?? '../../', import.meta.url));
const useDist = process.env.NOTEBOOK_USE_DIST === '1';
const ooxmlSource = !useDist && existsSync(`${ooxml}src/core/notebook/index.ts`);
const local = (path: string): string =>
	fileURLToPath(new URL(`../../viewers/notebook/packages/${path}`, import.meta.url));

export function sharedConfig(port: number): UserConfig {
	return {
		// Embedded files load their viewers on demand; discover the presentation engine before the
		// first one opens, avoiding a dev-server reload.
		optimizeDeps: { include: ['ooxml-core/pptx', 'ooxml-ui/pptx/dom', 'emf-converter'] },
		resolve: {
			// Yjs, ProseMirror and Lit break (instanceof, double registration) if two copies load.
			dedupe: [
				'yjs',
				'lib0',
				'y-protocols',
				'lit',
				'prosemirror-model',
				'prosemirror-state',
				'prosemirror-transform',
				'prosemirror-view',
				'react',
				'react-dom',
			],
			alias: [
				...(ooxmlSource
					? [
							{ find: /^ooxml-core\/(.+)$/, replacement: `${ooxml}src/core/$1` },
							{ find: /^ooxml-ui$/, replacement: `${ooxml}src/ui/src/index.ts` },
							{
								find: /^ooxml-ui\/notebook$/,
								replacement: `${ooxml}src/ui/src/notebook/index.ts`,
							},
							{
								find: /^ooxml-ui\/pptx\/dom$/,
								replacement: `${ooxml}src/ui/dist/pptx/dom/index.mjs`,
							},
						]
					: []),
				// The binding imports the private web component by name; the build inlines it.
				...(useDist
					? []
					: [
							{ find: /^notebook-viewer$/, replacement: local('web-component/src/index.ts') },
							{ find: /^opennotes-react-viewer$/, replacement: local('react/src/index.ts') },
						]),
			],
		},
		server: { port, strictPort: true, host: '127.0.0.1', fs: { allow: ['..', ooxml] } },
	};
}
