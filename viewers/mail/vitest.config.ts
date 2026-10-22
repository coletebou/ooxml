import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Tests run against this checkout's ooxml source when it is there, like the demos (no build
// needed). With MAIL_USE_DIST=1 they run against the published ooxml-core and ooxml-ui instead.
// OOXML_DIR names another checkout, written with or without a slash at the end.
const ooxml = resolve(
	fileURLToPath(new URL('.', import.meta.url)),
	process.env.OOXML_DIR || '../..',
).replaceAll('\\', '/');
const useSource =
	process.env.MAIL_USE_DIST !== '1' && existsSync(`${ooxml}/src/core/mail/index.ts`);

export default {
	resolve: {
		dedupe: ['lit'],
		alias: [
			...(useSource
				? [
						{ find: /^ooxml-core\/(.+)$/, replacement: `${ooxml}/src/core/$1/index.ts` },
						{ find: /^ooxml-ui$/, replacement: `${ooxml}/src/ui/src/index.ts` },
						{ find: /^ooxml-ui\/mail$/, replacement: `${ooxml}/src/ui/src/mail/index.ts` },
					]
				: []),
			{
				find: /^mail-viewer$/,
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
		include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.test.tsx'],
		exclude: ['node_modules', 'dist'],
		testTimeout: 15000,
	},
};
