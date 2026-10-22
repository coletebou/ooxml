// Starts the React demo on the demo mailbox (in memory, no server needed): http://127.0.0.1:5311/
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const demo = spawn(process.execPath, [vite, '--host', '127.0.0.1'], {
	stdio: 'inherit',
	cwd: '../../demos/mail/react',
});
process.on('SIGINT', () => demo.kill());
demo.on('exit', (code) => process.exit(code ?? 0));
