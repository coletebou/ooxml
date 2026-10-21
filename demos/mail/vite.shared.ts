import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { UserConfig } from 'vite';

// Local development against this checkout of the ooxml repository. By default a demo resolves
// ooxml-core and ooxml-ui from their SOURCE (instant reload when you edit either), and the binding
// packages from their source too. MAIL_USE_DIST=1 uses the built packages for both (run
// `bun run build:packages` first for this viewer's own ones).
const ooxml = fileURLToPath(new URL(process.env.OOXML_DIR ?? '../../', import.meta.url));
const useDist = process.env.MAIL_USE_DIST === '1';
const ooxmlSource = !useDist && existsSync(`${ooxml}src/core/mail/index.ts`);
const local = (path: string): string =>
	fileURLToPath(new URL(`../../viewers/mail/packages/${path}`, import.meta.url));

export function sharedConfig(port: number): UserConfig {
	return {
		// Discover the lazy presentation engine before first open, avoiding a dev-server reload.
		optimizeDeps: { include: ['ooxml-core/pptx', 'ooxml-ui/pptx/dom', 'emf-converter'] },
		resolve: {
			// Lit breaks (double registration) if two copies load: force one.
			dedupe: ['yjs', 'lib0', 'y-protocols', 'lit', 'react', 'react-dom'],
			alias: [
				...(ooxmlSource
					? [
							{ find: /^ooxml-core\/(.+)$/, replacement: `${ooxml}src/core/$1` },
							{ find: /^ooxml-ui$/, replacement: `${ooxml}src/ui/src/index.ts` },
							{ find: /^ooxml-ui\/mail$/, replacement: `${ooxml}src/ui/src/mail/index.ts` },
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
							{ find: /^mail-viewer$/, replacement: local('web-component/src/index.ts') },
							{ find: /^openmail-react-viewer$/, replacement: local('react/src/index.ts') },
						]),
			],
		},
		server: { port, strictPort: true, host: '127.0.0.1', fs: { allow: ['..', ooxml] } },
	};
}
