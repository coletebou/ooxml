import { chromium, defineConfig, devices } from '@playwright/test';
import { resolveChromiumExecutable } from '../../scripts/playwright-chromium.mjs';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 5309);
const origin = `http://127.0.0.1:${port}`;
// The bundled Chromium, or PLAYWRIGHT_CHROMIUM_EXECUTABLE (an installed Chrome) when it is missing.
const executablePath = resolveChromiumExecutable(chromium.executablePath());

// The specs live in e2e/notebook at the repository root and run against the React demo
// (demos/notebook/react) on its own port, so a dev server already running elsewhere is never
// mistaken for it. Each spec isolates its notebooks with `?storage=<name>`.
export default defineConfig({
	testDir: '../../e2e/notebook',
	fullyParallel: false,
	workers: 1,
	use: { baseURL: origin, headless: true },
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				...(executablePath ? { launchOptions: { executablePath } } : {}),
			},
		},
	],
	webServer: {
		command: `bun x vite --host 127.0.0.1 --port ${port} --strictPort --force`,
		cwd: '../../demos/notebook/react',
		url: origin,
		reuseExistingServer: false,
		timeout: 120_000,
	},
	reporter: 'list',
});
