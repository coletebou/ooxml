import { chromium, defineConfig } from '@playwright/test';
import { resolveChromiumExecutable } from '../../scripts/playwright-chromium.mjs';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4192);
const origin = `http://127.0.0.1:${port}`;
// PLAYWRIGHT_CHROMIUM_EXECUTABLE (or an installed browser cache) stands in for a missing bundled build.
const executablePath = resolveChromiumExecutable(chromium.executablePath());

// The specs live in e2e/mail at the repository root and run against the React demo
// (demos/mail/react) on its own port, so a dev server already running is never mistaken for it.
export default defineConfig({
	testDir: '../../e2e/mail',
	fullyParallel: false,
	workers: 1,
	use: {
		baseURL: origin,
		headless: true,
		...(executablePath ? { launchOptions: { executablePath } } : {}),
	},
	webServer: {
		command: `bun x vite --host 127.0.0.1 --port ${port} --strictPort --force`,
		cwd: '../../demos/mail/react',
		url: origin,
		reuseExistingServer: false,
		timeout: 120_000,
	},
	reporter: 'list',
});
